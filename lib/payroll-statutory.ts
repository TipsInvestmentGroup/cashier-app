// The Universal Payroll Framework's statutory engine (Phase 4). Resolves the
// effective-dated StatutoryRule for a code + date and computes its amount
// against the payslip variable namespace. Rates live entirely in data
// (StatutoryRule rows) — this file only interprets them. Resolution mirrors the
// Business Period Engine's versioning: the newest version whose effectiveFrom
// <= date (and effectiveTo null or >= date) wins, so re-running an old period
// reproduces the rule in force then. See docs/payroll-framework-design.md §11.
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'

export const STATUTORY_RULE_TYPES = ['TAX_BAND', 'FLAT_RATE', 'CAP', 'THRESHOLD'] as const
export type StatutoryRuleType = (typeof STATUTORY_RULE_TYPES)[number]

// Minimal shape we read off a StatutoryRule (kept loose to avoid coupling to the
// generated Prisma type).
export interface ResolvedStatutoryRule {
  id: string
  code: string
  name: string
  ruleType: string
  baseVar: string
  parameters: Record<string, unknown> | null
  employeeRate: number | null
  employerRate: number | null
  ceiling: number | null
  floor: number | null
  glMappingKey: string | null
  isEmployer: boolean
}

function safeJson(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try { return JSON.parse(raw) as Record<string, unknown> } catch { return null }
}

/**
 * Resolve the statutory rule for a code effective on `date` (newest version with
 * effectiveFrom <= date and effectiveTo null|>= date, isActive). Null if none —
 * callers treat that as "not configured" (contributes 0), never an error.
 */
export async function resolveStatutoryRule(db: Db, companyId: string, code: string, date: Date): Promise<ResolvedStatutoryRule | null> {
  const rows = await db.statutoryRule.findMany({
    where: {
      companyId,
      code,
      isActive: true,
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    orderBy: { effectiveFrom: 'desc' },
    take: 1,
  })
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id, code: r.code, name: r.name, ruleType: r.ruleType, baseVar: r.baseVar,
    parameters: safeJson(r.parameters), employeeRate: r.employeeRate, employerRate: r.employerRate,
    ceiling: r.ceiling, floor: r.floor, glMappingKey: r.glMappingKey, isEmployer: r.isEmployer,
  }
}

// Progressive marginal tax over bands [[lowerBound, marginalRate], ...] — kept
// local (no cross-import with lib/payroll-components) to avoid a cycle.
function marginal(x: number, bands: [number, number][]): number {
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

/**
 * Compute a statutory amount against the payslip variables. Applies floor
 * (no charge below it) and ceiling (cap the base) first, then the rule type:
 *   TAX_BAND  → progressive marginal over parameters.bands
 *   FLAT_RATE / CAP / THRESHOLD → base × (parameters.rate | employeeRate | employerRate)
 * Always non-negative and rounded to 2dp.
 */
export function computeStatutory(rule: ResolvedStatutoryRule, vars: Record<string, number>): number {
  const base0 = vars[rule.baseVar] ?? 0
  if (rule.floor != null && base0 < rule.floor) return 0
  let base = base0
  if (rule.ceiling != null) base = Math.min(base, rule.ceiling)

  const p = rule.parameters ?? {}
  switch (rule.ruleType) {
    case 'TAX_BAND': {
      const bands = (p.bands as [number, number][]) ?? []
      return roundMoney(Math.max(0, marginal(base, bands)))
    }
    case 'FLAT_RATE':
    case 'CAP':
    case 'THRESHOLD': {
      const rate = Number(p.rate ?? rule.employeeRate ?? rule.employerRate ?? 0)
      return roundMoney(Math.max(0, base * rate))
    }
    default:
      return 0
  }
}
