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
import { resolvePayrollConfig, type ResolvedPayrollConfig } from '@/lib/payroll-config'
import { resolveEffectivePeriodFields } from '@/lib/business-periods'
import { payrollPeriodForDate } from '@/lib/business-periods-shared'
import { extractVariables } from '@/lib/payroll-formula'
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
export async function previewPayslip(db: Db, employeeId: string, inputs: PreviewInputs = {}): Promise<PayslipPreview> {
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employeeNumber: true, categoryId: true, payGroupId: true, personId: true, userId: true, outletId: true, baseSalary: true },
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

  // Base variable namespace. Attendance inputs default to a full period / no
  // overtime (Phase 4 feeds these from real attendance).
  const daysWorked = inputs.daysWorked ?? daysInPeriod
  const vars: Record<string, number> = {
    base: employee.baseSalary,
    daysInPeriod,
    daysWorked,
    overtimeHours: inputs.overtimeHours ?? 0,
    unpaidDays: inputs.unpaidDays ?? 0,
    ...(inputs.extraVars ?? {}),
  }

  const srcCtx: SourceContext = {
    db,
    employee: { id: employee.id, personId: employee.personId, userId: employee.userId, outletId: employee.outletId },
    month: monthKey,
    manualAmounts: inputs.manualAmounts ?? {},
  }

  const all = await resolveEffectiveComponents(db, { id: employee.id, payGroupId: employee.payGroupId }, date)
  const earnings = all.filter((c) => bucketOf(c.componentType) === 'EARNING')
  const rest = all.filter((c) => bucketOf(c.componentType) !== 'EARNING')

  const lines: PayslipLinePreview[] = []

  // ── Tier 1: earnings (define gross / taxable / pensionable) ──
  const t1 = orderTier(earnings)
  if (t1.cycle) warnings.push('Circular dependency among earning components — order may be incorrect.')
  let gross = 0, taxable = 0, pensionable = 0
  for (const c of t1.ordered) {
    const r = await computeComponentAmount(c, vars, srcCtx)
    vars[c.code] = r.amount
    gross += r.amount
    if (c.taxable) taxable += r.amount
    if (c.pensionable) pensionable += r.amount
    if (r.error) warnings.push(`${c.code}: ${r.error}`)
    lines.push({ code: c.code, name: c.name, componentType: c.componentType, bucket: r.bucket, amount: r.amount, taxable: c.taxable, pensionable: c.pensionable, source: c.source, base: r.base, rate: r.rate, qty: r.qty, error: r.error })
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
    lines.push({ code: c.code, name: c.name, componentType: c.componentType, bucket: r.bucket, amount: r.amount, taxable: c.taxable, pensionable: c.pensionable, source: c.source, base: r.base, rate: r.rate, qty: r.qty, error: r.error })
  }
  totalDeductions = roundMoney(totalDeductions); employer = roundMoney(employer)

  // ── Net + negative-net policy ──
  let net = roundMoney(gross - totalDeductions)
  if (net < 0) {
    if (cfg.negativeNetPolicy === 'CAP') {
      warnings.push(`Deductions (${totalDeductions}) exceed gross (${gross}); capped so net = 0 (${totalDeductions - gross} uncollected).`)
      totalDeductions = gross
      net = 0
    } else if (cfg.negativeNetPolicy === 'CARRY_FORWARD') {
      warnings.push(`Deductions exceed gross by ${roundMoney(-net)}; net floored at 0, remainder carried forward.`)
      net = 0
    } else {
      warnings.push(`Deductions exceed gross by ${roundMoney(-net)} (negativeNetPolicy = BLOCK: this run would be rejected in Phase 3).`)
    }
  }

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
