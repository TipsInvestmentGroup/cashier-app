// The Universal Payroll Framework's payslip PREVIEW engine (Phase 2). Given an
// employee and a date, it resolves the effective pay components, builds a
// per-employee variable namespace, and computes a DRAFT payslip: gross →
// aggregates (taxable/pensionable) → deductions/employer contributions → net.
// It is strictly READ-ONLY: nothing is persisted and no GL posts — that is the
// PayrollRun of Phase 3. Two-tier evaluation avoids most circular references:
// earnings first (they define gross/taxable), then deductions/employer (which
// read those aggregates). Within a tier, components are ordered by their
// declared variable dependencies (topological), then by priority.
// See docs/payroll-framework-design.md §7, §9.
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'
import { resolvePayrollConfig, type ResolvedPayrollConfig, type NegativeNetPolicy } from '@/lib/payroll-config'
import { resolveEffectivePeriodFields } from '@/lib/business-periods'
import { payrollPeriodForDate } from '@/lib/business-periods-shared'
import { extractVariables } from '@/lib/payroll-formula'
import { aggregateAttendance } from '@/lib/payroll-attendance'
import {
  resolveEffectiveComponents,
  computeComponentAmount,
  bucketOf,
  type ResolvedComponent,
  type SourceContext,
} from '@/lib/payroll-components'

export interface PreviewInputs {
  date?: Date
  daysWorked?: number
  overtimeHours?: number
  unpaidDays?: number
  manualAmounts?: Record<string, number>
  extraVars?: Record<string, number>
}

export interface PayslipLinePreview {
  code: string
  name: string
  componentType: string
  bucket: 'EARNING' | 'DEDUCTION' | 'EMPLOYER'
  amount: number
  taxable: boolean
  pensionable: boolean
  source: 'EMPLOYEE' | 'GROUP'
  glMappingKey: string | null
  base?: number
  rate?: number
  qty?: number
  error?: string
}

export interface PayslipPreview {
  moduleEnabled: boolean
  currency: string
  employee: { id: string; employeeNumber: string | null; categoryId: string; payGroupId: string; baseSalary: number }
  period: { month: string; start: string; end: string; daysInPeriod: number; processingDate: string; paymentDate: string; lockDate: string }
  lines: PayslipLinePreview[]
  gross: number
  taxable: number
  pensionable: number
  totalDeductions: number
  net: number
  employerCost: number
  totalCost: number
  warnings: string[]
}

// Which of a component's referenced variables are themselves component codes in
// the current tier (i.e. real intra-tier dependencies to order around).
function intraTierDeps(comp: ResolvedComponent, codesInTier: Set<string>): string[] {
  const refs: string[] = []
  const p = comp.parameters ?? {}
  if (comp.calcMethod === 'FORMULA' && comp.formulaExpression) refs.push(...extractVariables(comp.formulaExpression))
  else if (comp.calcMethod === 'PERCENTAGE') refs.push(String(p.of ?? 'base'))
  else if (comp.calcMethod === 'RATE_QTY') refs.push(String(p.qtyVar ?? ''))
  else if (comp.calcMethod === 'TABLE') refs.push(String(p.var ?? ''))
  return refs.filter((r) => codesInTier.has(r) && r !== comp.code)
}

// Kahn topological sort; ties broken by priority (asc) then code. On a cycle,
// the remaining nodes are appended in priority order and `cycle` is set true.
function orderTier(comps: ResolvedComponent[]): { ordered: ResolvedComponent[]; cycle: boolean } {
  const codes = new Set(comps.map((c) => c.code))
  const deps = new Map<string, Set<string>>()
  for (const c of comps) deps.set(c.code, new Set(intraTierDeps(c, codes)))
  const byCode = new Map(comps.map((c) => [c.code, c]))
  const ordered: ResolvedComponent[] = []
  const ready = () =>
    [...deps.entries()]
      .filter(([, d]) => d.size === 0)
      .map(([code]) => byCode.get(code)!)
      .sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code))
  while (deps.size > 0) {
    const avail = ready()
    if (avail.length === 0) {
      // cycle — append the rest deterministically
      const rest = [...deps.keys()].map((c) => byCode.get(c)!).sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code))
      ordered.push(...rest)
      return { ordered, cycle: true }
    }
    const next = avail[0]
    ordered.push(next)
    deps.delete(next.code)
    for (const d of deps.values()) d.delete(next.code)
  }
  return { ordered, cycle: false }
}

/**
 * Compute a read-only payslip preview for one employee. Never throws for
 * per-component problems — those surface as line `error`s and `warnings`.
 */
/** One payslip line, as far as the negative-net cap needs to see it. */
export interface CappableLine {
  bucket: string
  amount: number
  glMappingKey?: string | null
  componentType: string
}

export interface NegativeNetResult {
  /** Deduction total after any capping (== gross when a cap was applied). */
  totalDeductions: number
  /** Net pay after policy (>= 0). */
  net: number
  /** How much deduction was deferred/capped this period (0 when net was already >= 0). */
  deferred: number
  warning: string | null
}

/**
 * Apply the negative-net policy when deductions exceed gross. CAP and
 * CARRY_FORWARD both reduce the actual DEDUCTION line amounts (mutated in place)
 * so they sum to gross and net = 0 — which is what makes the posting journal
 * balance (Dr earnings = Cr net(0) + Cr deductions). Reducing the lines, not
 * just the aggregate, keeps PayslipLine amounts, the stored total, and the
 * per-line GL credits consistent.
 *
 * Cuts in priority order: recovery (A/R-mapped, e.g. staff-purchase / bar-tab
 * recovery) first — the unrecovered part just leaves the signed bill
 * outstanding, so it is recovered next period; that IS the carry-forward, held
 * by the receivable subledger with no separate ledger entry — then other
 * non-statutory deductions, and statutory (PAYE/pension) only as an unavoidable
 * last resort since those must normally remit in full. BLOCK caps nothing (the
 * run is meant to be rejected).
 */
export function applyNegativeNetPolicy(
  lines: CappableLine[],
  gross: number,
  totalDeductions: number,
  policy: NegativeNetPolicy,
): NegativeNetResult {
  const net0 = roundMoney(gross - totalDeductions)
  if (net0 >= 0) return { totalDeductions, net: net0, deferred: 0, warning: null }
  const excess = roundMoney(-net0)
  if (policy === 'BLOCK') {
    return { totalDeductions, net: net0, deferred: 0, warning: `Deductions exceed gross by ${excess} (negativeNetPolicy = BLOCK: this run would be rejected).` }
  }
  const rank = (l: CappableLine) => (l.glMappingKey === 'ACCOUNTS_RECEIVABLE' ? 0 : l.componentType === 'STATUTORY' ? 2 : 1)
  const deductionLines = lines.filter((l) => l.bucket === 'DEDUCTION' && l.amount > 0).sort((a, b) => rank(a) - rank(b))
  let remaining = excess
  for (const l of deductionLines) {
    if (remaining <= 0) break
    const cut = roundMoney(Math.min(l.amount, remaining))
    l.amount = roundMoney(l.amount - cut)
    remaining = roundMoney(remaining - cut)
  }
  const newTotal = roundMoney(lines.filter((l) => l.bucket === 'DEDUCTION').reduce((s, l) => s + l.amount, 0))
  const newNet = roundMoney(gross - newTotal)
  const deferred = roundMoney(excess - remaining)
  const verb = policy === 'CARRY_FORWARD' ? 'carried forward (bill left outstanding)' : 'capped this period'
  return { totalDeductions: newTotal, net: newNet, deferred, warning: `Deductions exceeded gross by ${excess}; ${deferred} ${verb}; net = ${newNet}.` }
}

export async function previewPayslip(db: Db, employeeId: string, inputs: PreviewInputs = {}): Promise<PayslipPreview> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employeeNumber: true, categoryId: true, payGroupId: true, personId: true, userId: true, outletId: true, companyId: true, baseSalary: true },
  })
  if (!employee) throw new Error('Employee not found')

  const date = inputs.date ?? new Date()
  const cfg: ResolvedPayrollConfig = await resolvePayrollConfig(db, { outletId: employee.outletId })

  // Period window from the Business Period Engine (payroll cycle) — reused, not
  // reinvented. month is the end-month key (operational naming convention).
  const fields = await resolveEffectivePeriodFields({ outletId: employee.outletId, date })
  const pp = payrollPeriodForDate(date, fields)
  const daysInPeriod = Math.round((pp.end.getTime() - pp.start.getTime()) / 86_400_000) + 1
  const monthKey = `${pp.end.getFullYear()}-${String(pp.end.getMonth() + 1).padStart(2, '0')}`

  const warnings: string[] = []

  // Attendance drives overtime + unpaid absences (Phase 4b). Explicit inputs
  // override the aggregated attendance (for what-if previews). unpaidDays reduces
  // daysWorked, which prorates proratable earnings below.
  const att = await aggregateAttendance(db, employee.id, pp.start, pp.end)
  const overtimeHours = inputs.overtimeHours ?? att.overtimeHours
  const unpaidDays = inputs.unpaidDays ?? att.unpaidDays
  const daysWorked = inputs.daysWorked ?? Math.max(0, daysInPeriod - unpaidDays)
  const prorationFactor = daysInPeriod > 0 ? Math.min(1, Math.max(0, daysWorked / daysInPeriod)) : 1
  const vars: Record<string, number> = {
    base: employee.baseSalary,
    daysInPeriod,
    daysWorked,
    unpaidDays,
    overtimeHours,
    prorationFactor,
    ...(inputs.extraVars ?? {}),
  }

  const srcCtx: SourceContext = {
    db,
    employee: { id: employee.id, personId: employee.personId, userId: employee.userId, outletId: employee.outletId },
    companyId: employee.companyId,
    date: pp.end, // statutory rules resolve as of period end, like components
    month: monthKey,
    manualAmounts: inputs.manualAmounts ?? {},
  }

  // Resolve components as of the PERIOD END (the standard payroll snapshot): a
  // component effective by the close of the period applies to it — not keyed to
  // the raw anchor date, which for a mid-period calculation would wrongly exclude
  // assignments made earlier in the same period.
  const all = await resolveEffectiveComponents(db, { id: employee.id, payGroupId: employee.payGroupId }, pp.end)
  const earnings = all.filter((c) => bucketOf(c.componentType) === 'EARNING')
  const rest = all.filter((c) => bucketOf(c.componentType) !== 'EARNING')

  const lines: PayslipLinePreview[] = []

  // ── Tier 1: earnings (define gross / taxable / pensionable) ──
  const t1 = orderTier(earnings)
  if (t1.cycle) warnings.push('Circular dependency among earning components — order may be incorrect.')
  let gross = 0, taxable = 0, pensionable = 0
  for (const c of t1.ordered) {
    const r = await computeComponentAmount(c, vars, srcCtx)
    // Proratable earnings (e.g. basic salary) are scaled by daysWorked/daysInPeriod
    // so an unpaid absence reduces pay. Non-proratable earnings (e.g. overtime,
    // already actual-hours) are untouched.
    const amt = c.proratable && prorationFactor < 1 ? roundMoney(r.amount * prorationFactor) : r.amount
    vars[c.code] = amt
    gross += amt
    if (c.taxable) taxable += amt
    if (c.pensionable) pensionable += amt
    if (r.error) warnings.push(`${c.code}: ${r.error}`)
    lines.push({ code: c.code, name: c.name, componentType: c.componentType, bucket: r.bucket, amount: amt, taxable: c.taxable, pensionable: c.pensionable, source: c.source, glMappingKey: c.glMappingKey, base: r.base, rate: r.rate, qty: r.qty, error: r.error })
  }
  gross = roundMoney(gross); taxable = roundMoney(taxable); pensionable = roundMoney(pensionable)
  vars.gross = gross; vars.taxable = taxable; vars.pensionable = pensionable

  // ── Tier 2: deductions + employer contributions (read the aggregates) ──
  const t2 = orderTier(rest)
  if (t2.cycle) warnings.push('Circular dependency among deduction/employer components — order may be incorrect.')
  let totalDeductions = 0, employer = 0
  for (const c of t2.ordered) {
    const r = await computeComponentAmount(c, vars, srcCtx)
    vars[c.code] = r.amount
    if (r.bucket === 'DEDUCTION') totalDeductions += r.amount
    else if (r.bucket === 'EMPLOYER') employer += r.amount
    if (r.error) warnings.push(`${c.code}: ${r.error}`)
    lines.push({ code: c.code, name: c.name, componentType: c.componentType, bucket: r.bucket, amount: r.amount, taxable: c.taxable, pensionable: c.pensionable, source: c.source, glMappingKey: c.glMappingKey, base: r.base, rate: r.rate, qty: r.qty, error: r.error })
  }
  totalDeductions = roundMoney(totalDeductions); employer = roundMoney(employer)

  // ── Net + negative-net policy ── (mutates deduction line amounts in place)
  const nn = applyNegativeNetPolicy(lines, gross, totalDeductions, cfg.negativeNetPolicy)
  totalDeductions = nn.totalDeductions
  const net = nn.net
  if (nn.warning) warnings.push(nn.warning)

  return {
    moduleEnabled: cfg.enabled,
    currency: cfg.defaultCurrency,
    employee: { id: employee.id, employeeNumber: employee.employeeNumber, categoryId: employee.categoryId, payGroupId: employee.payGroupId, baseSalary: employee.baseSalary },
    period: { month: monthKey, start: pp.start.toISOString(), end: pp.end.toISOString(), daysInPeriod, processingDate: pp.processingDate.toISOString(), paymentDate: pp.paymentDate.toISOString(), lockDate: pp.lockDate.toISOString() },
    lines,
    gross,
    taxable,
    pensionable,
    totalDeductions,
    net,
    employerCost: employer,
    totalCost: roundMoney(gross + employer),
    warnings,
  }
}
