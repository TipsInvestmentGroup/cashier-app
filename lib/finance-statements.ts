// Financial Statements — Stage 6, the last piece of the Finance Platform.
// Everything here is computed live from JournalLine/Account data built up
// by Stages 1-5 — there is no separate "reporting" ledger to keep in sync.
// Statement of Changes in Equity is deliberately NOT built: nothing in this
// app posts equity transactions (owner contributions/drawings aren't
// modeled anywhere), so it would always show a trivial, always-empty
// statement — not worth pretending to.
import { prisma } from './prisma'
import { roundMoney } from './utils'
import { cashAccountIds } from './finance-banking'

const CREDIT_NORMAL_TYPES = ['LIABILITY', 'EQUITY', 'INCOME']

function signedBalance(type: string, debit: number, credit: number): number {
  return CREDIT_NORMAL_TYPES.includes(type) ? roundMoney(credit - debit) : roundMoney(debit - credit)
}

export interface TrialBalanceRow { accountId: string; code: string; name: string; type: string; debit: number; credit: number; balance: number }

/** Every account's cumulative balance as of a date — the classic "does the
 *  ledger balance" check. Since postJournalEntry() enforces debit=credit on
 *  every single entry, totalDebit and totalCredit here will always be
 *  equal; this endpoint mainly exists to prove that account-by-account,
 *  and to feed the Balance Sheet/Income Statement below. */
export async function trialBalance(companyId: string, asOfDate: Date): Promise<{ rows: TrialBalanceRow[]; totalDebit: number; totalCredit: number }> {
  const accounts = await prisma.account.findMany({ where: { companyId, isActive: true }, orderBy: [{ type: 'asc' }, { code: 'asc' }] })
  const lines = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: { account: { companyId }, journalEntry: { entryDate: { lte: asOfDate } } },
    _sum: { debit: true, credit: true },
  })
  const byAccount = new Map(lines.map((l) => [l.accountId, l]))

  const rows: TrialBalanceRow[] = []
  let totalDebit = 0
  let totalCredit = 0
  for (const a of accounts) {
    const agg = byAccount.get(a.id)
    const debit = roundMoney(agg?._sum.debit || 0)
    const credit = roundMoney(agg?._sum.credit || 0)
    if (debit === 0 && credit === 0) continue
    totalDebit = roundMoney(totalDebit + debit)
    totalCredit = roundMoney(totalCredit + credit)
    rows.push({ accountId: a.id, code: a.code, name: a.name, type: a.type, debit, credit, balance: signedBalance(a.type, debit, credit) })
  }
  return { rows, totalDebit, totalCredit }
}

export interface StatementLine { accountId: string; code: string; name: string; amount: number }

/** Revenue minus Expenses (incl. COGS) for a period — a pure INCOME/EXPENSE
 *  slice of activity, not a cumulative balance. */
export async function incomeStatement(companyId: string, periodStart: Date, periodEnd: Date) {
  const accounts = await prisma.account.findMany({ where: { companyId, type: { in: ['INCOME', 'EXPENSE'] } }, orderBy: { code: 'asc' } })
  const lines = await prisma.journalLine.groupBy({
    by: ['accountId'],
    where: { account: { companyId }, journalEntry: { entryDate: { gte: periodStart, lte: periodEnd } } },
    _sum: { debit: true, credit: true },
  })
  const byAccount = new Map(lines.map((l) => [l.accountId, l]))

  const revenue: StatementLine[] = []
  const expenses: StatementLine[] = []
  for (const a of accounts) {
    const agg = byAccount.get(a.id)
    const amount = signedBalance(a.type, roundMoney(agg?._sum.debit || 0), roundMoney(agg?._sum.credit || 0))
    if (amount === 0) continue
    ;(a.type === 'INCOME' ? revenue : expenses).push({ accountId: a.id, code: a.code, name: a.name, amount })
  }
  const totalRevenue = roundMoney(revenue.reduce((s, r) => s + r.amount, 0))
  const totalExpenses = roundMoney(expenses.reduce((s, r) => s + r.amount, 0))
  return { revenue, expenses, totalRevenue, totalExpenses, netProfit: roundMoney(totalRevenue - totalExpenses) }
}

/** Assets = Liabilities + Equity, as of a point in time. `balanced` should
 *  always be true given the GL's own invariants — surfaced so a UI can
 *  flag it loudly if it's ever not (would indicate a real bug). */
export async function balanceSheet(companyId: string, asOfDate: Date) {
  const { rows } = await trialBalance(companyId, asOfDate)
  const assets = rows.filter((r) => r.type === 'ASSET').map((r) => ({ accountId: r.accountId, code: r.code, name: r.name, amount: r.balance }))
  const liabilities = rows.filter((r) => r.type === 'LIABILITY').map((r) => ({ accountId: r.accountId, code: r.code, name: r.name, amount: r.balance }))
  const equity = rows.filter((r) => r.type === 'EQUITY').map((r) => ({ accountId: r.accountId, code: r.code, name: r.name, amount: r.balance }))
  // Retained earnings aren't posted as a distinct equity entry anywhere in
  // this app (there's no period-close/roll-forward step) — net profit to
  // date is shown as an implicit equity line instead of silently omitted.
  const { netProfit } = await incomeStatement(companyId, new Date(0), asOfDate)
  const totalAssets = roundMoney(assets.reduce((s, a) => s + a.amount, 0))
  const totalLiabilities = roundMoney(liabilities.reduce((s, a) => s + a.amount, 0))
  const totalEquity = roundMoney(equity.reduce((s, a) => s + a.amount, 0) + netProfit)
  return {
    assets, totalAssets, liabilities, totalLiabilities,
    equity: [...equity, { accountId: 'retained-earnings', code: '3900', name: 'Retained Earnings (Net Profit To Date)', amount: netProfit }],
    totalEquity, balanced: roundMoney(totalAssets - (totalLiabilities + totalEquity)) === 0,
  }
}

export interface CashFlowGroup { sourceModule: string; amount: number }

/**
 * Direct-method cash flow: opening balance + cash in/out over the period,
 * grouped by sourceModule (the same tag every postJournalEntry() call
 * already carries) rather than the classic Operating/Investing/Financing
 * split — this app has no investing or financing GL activity types yet
 * (no fixed-asset purchases, no loans), so that split would be
 * meaningless. "Cash" here means any account behind a CompanyPaymentAccount
 * plus the three seeded default Cash/Bank/Mobile-Money accounts.
 */
export async function cashFlowStatement(companyId: string, periodStart: Date, periodEnd: Date) {
  const cashIds = await cashAccountIds(companyId)
  if (!cashIds.length) return { openingBalance: 0, closingBalance: 0, inflows: [], outflows: [], netChange: 0 }

  const openingLines = await prisma.journalLine.findMany({
    where: { accountId: { in: cashIds }, journalEntry: { entryDate: { lt: periodStart } } },
    select: { debit: true, credit: true },
  })
  const openingBalance = roundMoney(openingLines.reduce((s, l) => s + l.debit - l.credit, 0))

  const periodLines = await prisma.journalLine.findMany({
    where: { accountId: { in: cashIds }, journalEntry: { entryDate: { gte: periodStart, lte: periodEnd } } },
    include: { journalEntry: { select: { sourceModule: true } } },
  })
  const inMap = new Map<string, number>()
  const outMap = new Map<string, number>()
  for (const l of periodLines) {
    const mod = l.journalEntry.sourceModule
    if (l.debit > 0) inMap.set(mod, roundMoney((inMap.get(mod) || 0) + l.debit))
    if (l.credit > 0) outMap.set(mod, roundMoney((outMap.get(mod) || 0) + l.credit))
  }
  const inflows: CashFlowGroup[] = [...inMap.entries()].map(([sourceModule, amount]) => ({ sourceModule, amount }))
  const outflows: CashFlowGroup[] = [...outMap.entries()].map(([sourceModule, amount]) => ({ sourceModule, amount }))
  const netChange = roundMoney(inflows.reduce((s, i) => s + i.amount, 0) - outflows.reduce((s, o) => s + o.amount, 0))
  return { openingBalance, closingBalance: roundMoney(openingBalance + netChange), inflows, outflows, netChange }
}
