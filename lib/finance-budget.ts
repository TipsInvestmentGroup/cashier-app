// Budgeting & Forecasting — Stage 4. A Budget targets one GL Account over
// one period, scoped to a company and optionally an outlet (branch);
// department/event are organizational tags on the budget (see the Budget
// model comment in prisma/schema.prisma for why Actual isn't split by them).
import { roundMoney } from './utils'
import { prisma } from './prisma'

/**
 * Sums this account's journal activity within [periodStart, periodEnd],
 * normalized to the account's natural balance sign so "Actual" reads
 * positive for money flowing the way the account expects: ASSET/EXPENSE
 * accounts are debit-normal (Actual = debit − credit); LIABILITY/EQUITY/
 * INCOME accounts are credit-normal (Actual = credit − debit).
 */
export async function computeActual(opts: { companyId: string; accountId: string; outletId?: string | null; periodStart: Date; periodEnd: Date }): Promise<number> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: opts.accountId } })
  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: opts.accountId,
      ...(opts.outletId ? { outletId: opts.outletId } : {}),
      journalEntry: { companyId: opts.companyId, entryDate: { gte: opts.periodStart, lte: opts.periodEnd } },
    },
    select: { debit: true, credit: true },
  })
  const debitTotal = lines.reduce((s, l) => s + l.debit, 0)
  const creditTotal = lines.reduce((s, l) => s + l.credit, 0)
  const creditNormal = account.type === 'LIABILITY' || account.type === 'EQUITY' || account.type === 'INCOME'
  return roundMoney(creditNormal ? creditTotal - debitTotal : debitTotal - creditTotal)
}

export interface BudgetVsActual {
  budgetAmount: number
  actual: number
  variance: number
  variancePercent: number | null
  forecast: number
}

/**
 * Budget → Actual → Variance → Variance % → Forecast, per the spec.
 * Forecast is a simple linear run-rate: actual ÷ elapsed-fraction-of-period,
 * clamped to the budget amount before the period starts and to the actual
 * once the period has fully elapsed (no more time left to extrapolate over).
 */
export function computeForecast(budgetAmount: number, actual: number, periodStart: Date, periodEnd: Date, now: Date): number {
  const totalMs = periodEnd.getTime() - periodStart.getTime()
  if (totalMs <= 0) return actual
  const elapsedMs = now.getTime() - periodStart.getTime()
  const elapsedFraction = Math.min(1, Math.max(0, elapsedMs / totalMs))
  if (elapsedFraction <= 0) return roundMoney(budgetAmount)
  if (elapsedFraction >= 1) return roundMoney(actual)
  return roundMoney(actual / elapsedFraction)
}

export async function budgetVsActual(budgetId: string, now: Date = new Date()): Promise<BudgetVsActual> {
  const budget = await prisma.budget.findUniqueOrThrow({ where: { id: budgetId } })
  const actual = await computeActual({
    companyId: budget.companyId, accountId: budget.accountId, outletId: budget.outletId,
    periodStart: budget.periodStart, periodEnd: budget.periodEnd,
  })
  const variance = roundMoney(actual - budget.amount)
  const variancePercent = budget.amount !== 0 ? roundMoney((variance / budget.amount) * 100) : null
  const forecast = computeForecast(budget.amount, actual, budget.periodStart, budget.periodEnd, now)
  return { budgetAmount: budget.amount, actual, variance, variancePercent, forecast }
}
