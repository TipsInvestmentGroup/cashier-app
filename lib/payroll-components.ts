// Component resolution + single-component calculation for the Universal Payroll
// Framework (Phase 2). Resolves which PayComponents apply to an employee
// (employee-level assignment overrides pay-group-level, effective-dated), and
// computes one component's amount for the given variable namespace + calc
// method. SOURCED components pull their value from an adapter — most notably
// CREDIT_BALANCE, which reads the employee's outstanding via the Credit
// framework (closing the loop the Credit doc reserved for Payroll). Pure
// computation, no persistence. See docs/payroll-framework-design.md §5–7.
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'
import { evaluateExpression, FormulaError } from '@/lib/payroll-formula'

export const EARNING_TYPES = ['EARNING', 'ALLOWANCE', 'BENEFIT'] as const
export const DEDUCTION_TYPES = ['DEDUCTION', 'STATUTORY'] as const
export const EMPLOYER_TYPES = ['EMPLOYER_CONTRIBUTION'] as const

export type ComponentBucket = 'EARNING' | 'DEDUCTION' | 'EMPLOYER'
export function bucketOf(componentType: string): ComponentBucket {
  if ((DEDUCTION_TYPES as readonly string[]).includes(componentType)) return 'DEDUCTION'
  if ((EMPLOYER_TYPES as readonly string[]).includes(componentType)) return 'EMPLOYER'
  return 'EARNING'
}

// The shape of a PayComponent we actually read (kept loose to avoid coupling to
// the generated Prisma type; the query below selects exactly these).
export interface ResolvedComponent {
  id: string
  code: string
  name: string
  componentType: string
  calcMethod: string
  parameters: Record<string, unknown> | null
  formulaExpression: string | null
  taxable: boolean
  pensionable: boolean
  priority: number
  proratable: boolean
  minLimit: number | null
  maxLimit: number | null
  amountOverride: number | null
  glMappingKey: string | null
  source: 'EMPLOYEE' | 'GROUP'
}

function safeJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try { return JSON.parse(raw) as Record<string, unknown> } catch { return null }
}

/**
 * Resolve the effective components for an employee on `date`: the union of
 * assignments to the employee's pay group and directly to the employee, with the
 * employee-level assignment WINNING per component code (override). Only ACTIVE,
 * currently-effective components/assignments are returned.
 */
export async function resolveEffectiveComponents(db: Db, employee: { id: string; payGroupId: string }, date: Date): Promise<ResolvedComponent[]> {
  const assignments = await db.componentAssignment.findMany({
    where: {
      OR: [{ employeeId: employee.id }, { payGroupId: employee.payGroupId }],
      effectiveFrom: { lte: date },
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] }],
    },
    include: { component: { include: { formula: true } } },
  })

  // Employee-level wins over group-level, keyed by component code.
  const byCode = new Map<string, ResolvedComponent>()
  for (const a of assignments) {
    const c = a.component
    if (!c || c.status !== 'ACTIVE') continue
    if (c.effectiveFrom && c.effectiveFrom > date) continue
    if (c.effectiveTo && c.effectiveTo < date) continue
    const isEmployeeLevel = !!a.employeeId
    const existing = byCode.get(c.code)
    if (existing && existing.source === 'EMPLOYEE' && !isEmployeeLevel) continue // keep the employee override
    byCode.set(c.code, {
      id: c.id,
      code: c.code,
      name: c.name,
      componentType: c.componentType,
      calcMethod: c.calcMethod,
      parameters: safeJson(a.parametersOverride) ?? safeJson(c.parameters),
      formulaExpression: c.formula?.expression ?? null,
      taxable: c.taxable,
      pensionable: c.pensionable,
      priority: c.priority,
      proratable: c.proratable,
      minLimit: c.minLimit,
      maxLimit: c.maxLimit,
      amountOverride: a.amountOverride ?? null,
      glMappingKey: c.glMappingKey,
      source: isEmployeeLevel ? 'EMPLOYEE' : 'GROUP',
    })
  }
  return [...byCode.values()]
}

// Context a SOURCED component needs to look its value up.
export interface SourceContext {
  db: Db
  employee: { id: string; personId: string | null; userId: string | null; outletId: string | null }
  month: string | null // 'YYYY-MM' of the payroll period, for period-scoped sources
  manualAmounts: Record<string, number> // per-run one-off entries, keyed by component code
}

/**
 * SOURCED adapter: resolve a component's amount from an external provider.
 *   CREDIT_BALANCE — the employee's outstanding from the Credit framework
 *     (CreditAccount.currentBalance, matched by personId then userId). Returns 0
 *     when the employee isn't linked to a credit account yet (the normal Phase-1
 *     state, since seeded employees carry userId only) — safe, not an error.
 *   MANUAL — a one-off amount entered on the run (manualAmounts[code]).
 *   LOAN_SCHEDULE | ADVANCE | STATUTORY — reserved for later phases; 0 for now.
 */
async function resolveSourcedAmount(source: string, code: string, ctx: SourceContext): Promise<number> {
  switch (source) {
    case 'CREDIT_BALANCE': {
      const { db, employee } = ctx
      let account: { currentBalance: number } | null = null
      if (employee.personId) {
        account = await db.creditAccount.findUnique({ where: { personId: employee.personId }, select: { currentBalance: true } })
      }
      if (!account && employee.userId) {
        account = await db.creditAccount.findFirst({ where: { userId: employee.userId }, select: { currentBalance: true } })
      }
      return account ? Math.max(0, account.currentBalance) : 0
    }
    case 'MANUAL':
      return Math.max(0, ctx.manualAmounts[code] ?? 0)
    case 'LOAN_SCHEDULE':
    case 'ADVANCE':
    case 'STATUTORY':
      return 0 // wired in a later phase
    default:
      throw new FormulaError(`Unknown SOURCED source "${source}"`)
  }
}

function progressiveTable(x: number, bands: [number, number][]): number {
  // bands = [[lowerBound, marginalRate], ...] ascending by lowerBound.
  const sorted = [...bands].sort((a, b) => a[0] - b[0])
  let tax = 0
  for (let i = 0; i < sorted.length; i++) {
    const [lo, rate] = sorted[i]
    if (x <= lo) break
    const hi = i + 1 < sorted.length ? sorted[i + 1][0] : Infinity
    tax += (Math.min(x, hi) - lo) * rate
  }
  return tax
}

export interface ComponentResult {
  amount: number
  bucket: ComponentBucket
  base?: number
  rate?: number
  qty?: number
  error?: string
}

/**
 * Compute one component's amount for the given variable namespace. Never throws:
 * a bad formula/parameter yields { amount: 0, error } so one broken component
 * can't sink the whole payslip preview. Applies min/max limits and rounding.
 */
export async function computeComponentAmount(comp: ResolvedComponent, vars: Record<string, number>, ctx: SourceContext): Promise<ComponentResult> {
  const bucket = bucketOf(comp.componentType)
  try {
    let amount: number
    const detail: { base?: number; rate?: number; qty?: number } = {}

    if (comp.amountOverride !== null) {
      amount = comp.amountOverride
    } else {
      const p = comp.parameters ?? {}
      switch (comp.calcMethod) {
        case 'FIXED':
          amount = Number(p.amount ?? 0)
          break
        case 'PERCENTAGE': {
          const ofVar = String(p.of ?? 'base')
          if (!(ofVar in vars)) throw new FormulaError(`PERCENTAGE "of" references unknown variable "${ofVar}"`)
          const base = vars[ofVar]
          const percent = Number(p.percent ?? 0)
          detail.base = base
          detail.rate = percent
          amount = (percent / 100) * base
          break
        }
        case 'RATE_QTY': {
          const qtyVar = String(p.qtyVar ?? '')
          if (!(qtyVar in vars)) throw new FormulaError(`RATE_QTY "qtyVar" references unknown variable "${qtyVar}"`)
          const rate = Number(p.rate ?? 0)
          const qty = vars[qtyVar]
          detail.rate = rate
          detail.qty = qty
          amount = rate * qty
          break
        }
        case 'TABLE': {
          const v = String(p.var ?? 'taxable')
          if (!(v in vars)) throw new FormulaError(`TABLE "var" references unknown variable "${v}"`)
          const bands = (p.bands as [number, number][]) ?? []
          detail.base = vars[v]
          amount = progressiveTable(vars[v], bands)
          break
        }
        case 'FORMULA': {
          if (!comp.formulaExpression) throw new FormulaError('FORMULA component has no formula expression')
          amount = evaluateExpression(comp.formulaExpression, vars)
          break
        }
        case 'SOURCED': {
          const src = String(p.source ?? '')
          amount = await resolveSourcedAmount(src, comp.code, ctx)
          break
        }
        default:
          throw new FormulaError(`Unknown calcMethod "${comp.calcMethod}"`)
      }
    }

    if (comp.minLimit !== null && amount < comp.minLimit) amount = comp.minLimit
    if (comp.maxLimit !== null && amount > comp.maxLimit) amount = comp.maxLimit
    amount = roundMoney(Math.max(0, amount)) // payslip lines are non-negative magnitudes
    return { amount, bucket, ...detail }
  } catch (e) {
    return { amount: 0, bucket, error: e instanceof Error ? e.message : String(e) }
  }
}
