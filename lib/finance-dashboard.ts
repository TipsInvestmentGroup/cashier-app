// Financial Dashboard — Stage 6. A handful of the spec's dashboard tiles
// that are honestly computable from data this app tracks today: Cash
// Position, Outstanding Payables/Receivables, Budget Utilization, a
// liquidity/working-capital proxy, and a 6-month Revenue/Expense trend.
// Branch/Department Performance and a true current/non-current Liquidity
// Ratio are NOT built — accounts aren't classified current vs. non-current,
// and journal lines aren't tagged by department (see the Budget model
// comment in prisma/schema.prisma), so those would be guesses dressed up
// as numbers.
import { format, subMonths, startOfMonth } from 'date-fns'
import { prisma } from './prisma'
import { roundMoney } from './utils'
import { outstandingReceivablesWhere, outstandingBalance } from './finance-receivables'
import { cashAccountIds } from './finance-banking'

async function cashPosition(companyId: string): Promise<number> {
  const ids = await cashAccountIds(companyId)
  if (!ids.length) return 0
  const lines = await prisma.journalLine.findMany({ where: { accountId: { in: ids } }, select: { debit: true, credit: true } })
  return roundMoney(lines.reduce((s, l) => s + l.debit - l.credit, 0))
}

async function outstandingPayables(companyId: string): Promise<number> {
  const invoices = await prisma.supplierInvoice.findMany({ where: { companyId, status: { notIn: ['PAID', 'CANCELLED'] } }, select: { total: true, amountPaid: true } })
  return roundMoney(invoices.reduce((s, i) => s + (i.total - i.amountPaid), 0))
}

async function outstandingReceivables(companyId: string): Promise<number> {
  // Uses the exact same where-clause and balance formula as
  // app/api/receivables/route.ts (lib/finance-receivables.ts) — a company-
  // wide total, not a per-bill breakdown, but computed identically so the
  // two can never silently disagree.
  const bills = await prisma.signedBill.findMany({
    where: outstandingReceivablesWhere({ companyId }),
    include: { payments: true, writeOffs: true },
  })
  return roundMoney(bills.reduce((s, b) => s + outstandingBalance(b), 0))
}

async function budgetUtilization(companyId: string): Promise<number | null> {
  const budgets = await prisma.budget.findMany({ where: { companyId } })
  if (!budgets.length) return null
  let totalBudget = 0
  let totalActual = 0
  for (const b of budgets) {
    const lines = await prisma.journalLine.findMany({
      where: { accountId: b.accountId, journalEntry: { companyId, entryDate: { gte: b.periodStart, lte: b.periodEnd } } },
      select: { debit: true, credit: true },
    })
    const account = await prisma.account.findUniqueOrThrow({ where: { id: b.accountId } })
    const creditNormal = account.type === 'LIABILITY' || account.type === 'EQUITY' || account.type === 'INCOME'
    const actual = lines.reduce((s, l) => s + (creditNormal ? l.credit - l.debit : l.debit - l.credit), 0)
    totalBudget += b.amount
    totalActual += actual
  }
  return totalBudget > 0 ? roundMoney((totalActual / totalBudget) * 100) : null
}

async function monthlyTrend(companyId: string, accountType: 'INCOME' | 'EXPENSE'): Promise<{ month: string; amount: number }[]> {
  const start = startOfMonth(subMonths(new Date(), 5))
  const accounts = await prisma.account.findMany({ where: { companyId, type: accountType }, select: { id: true } })
  const accountIds = accounts.map((a) => a.id)
  if (!accountIds.length) return []

  const lines = await prisma.journalLine.findMany({
    where: { accountId: { in: accountIds }, journalEntry: { entryDate: { gte: start } } },
    include: { journalEntry: { select: { entryDate: true } } },
  })
  const buckets = new Map<string, number>()
  for (let i = 0; i < 6; i++) buckets.set(format(subMonths(new Date(), 5 - i), 'yyyy-MM'), 0)
  for (const l of lines) {
    const key = format(l.journalEntry.entryDate, 'yyyy-MM')
    if (!buckets.has(key)) continue
    const signed = accountType === 'INCOME' ? l.credit - l.debit : l.debit - l.credit
    buckets.set(key, roundMoney((buckets.get(key) || 0) + signed))
  }
  return [...buckets.entries()].map(([month, amount]) => ({ month, amount }))
}

export interface FinancialDashboard {
  cashPosition: number
  outstandingPayables: number
  outstandingReceivables: number
  budgetUtilization: number | null
  liquidityRatio: number | null
  workingCapital: number
  revenueTrend: { month: string; amount: number }[]
  expenseTrend: { month: string; amount: number }[]
}

export async function financialDashboard(companyId: string): Promise<FinancialDashboard> {
  const [cash, payables, receivables, utilization, revenueTrend, expenseTrend] = await Promise.all([
    cashPosition(companyId), outstandingPayables(companyId), outstandingReceivables(companyId),
    budgetUtilization(companyId), monthlyTrend(companyId, 'INCOME'), monthlyTrend(companyId, 'EXPENSE'),
  ])
  const liquidAssets = roundMoney(cash + receivables)
  return {
    cashPosition: cash, outstandingPayables: payables, outstandingReceivables: receivables, budgetUtilization: utilization,
    liquidityRatio: payables > 0 ? roundMoney(liquidAssets / payables) : null,
    workingCapital: roundMoney(liquidAssets - payables),
    revenueTrend, expenseTrend,
  }
}
