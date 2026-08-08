// Custodian Report — the cross-fund, custodian-accountability view (Custodian
// Report Spec v2 §1–§6). Where lib/expense-ledger.ts answers "what is the live
// balance of ONE fund right now?", this answers "for a DATE RANGE, how much did
// each custodian receive (Debited), how much did they spend, and how much are
// they holding at the end (Closing)?" — across all three fund classes at once.
//
// Deliberately reuses the existing single-source-of-truth machinery rather than
// storing a second copy of any balance:
//   • the three funds stay a derived view over FundingSource.sourceType
//     (lib/expense-funds.ts fundClassOf) — no fundClass column, §5's rule;
//   • Petty Cash movement comes from the FundingSourceTxn ledger;
//   • Cashier Cash movement comes from the same cash-recon arithmetic the Cash
//     Reconciliation screen posts (lib/cash-recon.ts);
//   • Digital movement comes from ExpensePayment + the live GL balance
//     (companyAccountBalance), the way lib/expense-ledger.ts already resolves a
//     bank-backed fund.
//
// LOCKED DECISIONS (confirmed with the product owner before build):
//   • Initial float (a fund's first OPEN row) belongs in Opening Balance, NOT in
//     Debited. Debited = replenishments / top-ups during the period only. An
//     in-period OPEN is therefore folded into Opening here, which also keeps the
//     accounting identity Closing = Opening + Debited − Spent exact.
//   • Cashier Cash is NOT topped up via the Digital-Custodian route — its balance
//     opens from the prior day's closing + the day's takings, so its Debited is
//     cash collected + cash paid-bills, its Spent is cash expenses.
//   • Variance flagging is IN for v1: a fund's computed closing is compared to an
//     independent recorded figure (CashRecon physical count for Cashier Cash;
//     append-only ledger drift for Petty Cash) and flagged on mismatch (§6) —
//     never silently overridden.
//
// KNOWN v1 LIMITATION (resolved in Phase B): a Digital fund's balance is read
// live (there is no historical GL snapshot per date), so its period Opening is
// back-derived from the live Closing, and Debited (deposits by cashiers,
// internal top-up transfers, withdrawals) is 0 until the §2.1/§9.1 account-level
// transaction subtypes exist. Digital variance is UNVERIFIABLE until then.
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { getFundingSourceBalance } from '@/lib/expense-ledger'
import { FUND_CLASSES, fundClassOf, FUND_CLASS_LABELS, type FundClass } from '@/lib/expense-funds'
import { previousClosing, utcDayStart, utcDayRange } from '@/lib/cash-recon'

export type VarianceStatus = 'RECONCILED' | 'MISMATCH' | 'UNVERIFIABLE'

export interface CustodianVariance {
  status: VarianceStatus
  note: string
  /** The independent recorded figure to compare Closing against (a physical
   *  count for Cashier Cash, the append-only ledger sum for Petty Cash), or null
   *  when there is nothing independent to compare (§6: don't fake a green tick). */
  recordedBalance: number | null
  /** recordedBalance − computed Closing, or null when unverifiable. */
  difference: number | null
}

export interface CustodianReportRow {
  fundingSourceId: string
  fundName: string
  fundClass: FundClass
  fundClassLabel: string
  outletId: string | null
  outletName: string
  /** Assigned custodian name(s), comma-joined; "Unassigned" when none. */
  custodianName: string
  custodianUserIds: string[]
  opening: number
  debited: number
  spent: number
  closing: number
  variance: CustodianVariance
}

export interface CustodianTotals {
  opening: number
  debited: number
  spent: number
  closing: number
}

export interface CustodianReport {
  from: Date
  to: Date
  rows: CustodianReportRow[]
  /** One summary per fund class (the §4 summary cards). */
  byFundClass: { fundClass: FundClass; label: string; totals: CustodianTotals; flagged: number }[]
  /** The combined card — sum across every row in scope. */
  combined: CustodianTotals
  /** How many rows carry a MISMATCH flag, for a headline count. */
  flaggedCount: number
}

export interface CustodianReportParams {
  from: Date
  to: Date
  /** null = all outlets (oversight roles only — the API scopes this first). */
  outletId?: string | null
  /** null = all fund classes. */
  fundClass?: FundClass | null
}

const zeroTotals = (): CustodianTotals => ({ opening: 0, debited: 0, spent: 0, closing: 0 })

interface FundPeriod {
  opening: number
  debited: number
  spent: number
  closing: number
  variance: CustodianVariance
}

/**
 * Petty Cash (and OTHER CASH funds): everything is in the FundingSourceTxn
 * ledger, so period figures are windowed sums of signed rows.
 *   opening  = balance just before `from`, plus any in-period OPEN (float →
 *              Opening, per the locked decision)
 *   debited  = positive, non-OPEN rows in the period (REPLENISH / top-up / +ADJUST)
 *   spent    = |negative rows| in the period (PAYMENT / −ADJUST)
 *   closing  = opening + debited − spent  (== balance just after `to`, by
 *              construction — the identity holds exactly)
 * Variance mirrors the §6 reconciliation route: a fund born in this framework
 * has an OPEN row, so Σ(all txns) must equal currentBalance; any gap is real
 * two-writer drift. A fund seeded from legacy petty cash has no OPEN anchor, so
 * there is nothing to independently verify and we say so.
 */
async function computeCashLedgerPeriod(
  source: { id: string; currentBalance: number },
  from: Date,
  to: Date,
): Promise<FundPeriod> {
  const txns = await prisma.fundingSourceTxn.findMany({
    where: { fundingSourceId: source.id },
    orderBy: { createdAt: 'asc' },
    select: { type: true, amount: true, createdAt: true },
  })

  const inPeriod = (d: Date) => d >= from && d <= to
  const afterOpening = (d: Date) => d >= from // everything from `from` onward

  const sumFromOpeningOnward = roundMoney(txns.filter((t) => afterOpening(t.createdAt)).reduce((s, t) => s + t.amount, 0))
  const rawOpening = roundMoney(source.currentBalance - sumFromOpeningOnward)
  const openInPeriod = roundMoney(txns.filter((t) => t.type === 'OPEN' && inPeriod(t.createdAt)).reduce((s, t) => s + t.amount, 0))
  const opening = roundMoney(rawOpening + openInPeriod)

  const debited = roundMoney(txns.filter((t) => inPeriod(t.createdAt) && t.amount > 0 && t.type !== 'OPEN').reduce((s, t) => s + t.amount, 0))
  const spent = roundMoney(txns.filter((t) => inPeriod(t.createdAt) && t.amount < 0).reduce((s, t) => s - t.amount, 0))
  const closing = roundMoney(opening + debited - spent)

  // §6 variance: ledger drift against the materialized currentBalance.
  const txnSumAll = roundMoney(txns.reduce((s, t) => s + t.amount, 0))
  const hasOpen = txns.some((t) => t.type === 'OPEN')
  let variance: CustodianVariance
  if (hasOpen) {
    const drift = Math.abs(roundMoney(txnSumAll - source.currentBalance)) > 0.005
    variance = drift
      ? { status: 'MISMATCH', note: 'The append-only ledger no longer sums to the fund balance — a write updated one without the other.', recordedBalance: txnSumAll, difference: roundMoney(txnSumAll - closing) }
      : { status: 'RECONCILED', note: 'The append-only ledger sums exactly to the fund balance.', recordedBalance: txnSumAll, difference: 0 }
  } else {
    variance = { status: 'UNVERIFIABLE', note: 'This fund’s opening balance predates ledger tracking (e.g. migrated from legacy petty cash), so movements can’t yet be independently reconciled.', recordedBalance: null, difference: null }
  }

  return { opening, debited, spent, closing, variance }
}

/**
 * Cashier Cash (CASHIER_DRAWER): no stored ledger — the balance IS the live cash
 * position, so period figures come from the same arithmetic lib/cash-recon.ts
 * posts, scoped to this drawer's outlet:
 *   opening  = the closing cash carried into `from` (previous day's close)
 *   debited  = cash collected + cash paid-bills over the period (money into the
 *              drawer)
 *   spent    = cash expenses disbursed over the period (money out)
 *   closing  = opening + debited − spent
 * Variance (§6): the genuine reconciliation for a cash drawer is the physical
 * count. If the period-end day has a verified CashRecon, compare its counted
 * amount to the computed closing and flag any gap; otherwise unverifiable.
 */
async function computeCashierDrawerPeriod(
  outletId: string | null,
  from: Date,
  to: Date,
): Promise<FundPeriod> {
  // UTC day windowing to match how DailyCollection/PaidBill/PettyCash.date and
  // CashRecon.date are stored (see lib/cash-recon.ts's windowing note).
  const range = { gte: utcDayStart(from), lte: utcDayRange(to).lte }
  const outletFilter = outletId ? { outletId } : {}
  const cashSourceFilter: { sourceType: { in: string[] }; outletId?: string } = { sourceType: { in: ['CASH', 'CASHIER_DRAWER'] } }
  if (outletId) cashSourceFilter.outletId = outletId

  const [opening, coll, paid, petty, expensePayments, endRecon] = await Promise.all([
    previousClosing(from, outletId),
    prisma.dailyCollection.aggregate({ where: { date: range, ...outletFilter }, _sum: { cash: true } }),
    prisma.paidBill.aggregate({ where: { date: range, paymentMethod: 'CASH', ...outletFilter }, _sum: { amountPaid: true } }),
    prisma.pettyCash.aggregate({ where: { date: range, paymentMethod: 'CASH', paymentStatus: 'PAID', pettyType: 'CASHIER', ...outletFilter }, _sum: { amount: true } }),
    prisma.expensePayment.aggregate({ where: { paidAt: range, fundingSource: cashSourceFilter }, _sum: { amount: true } }),
    // The physical count on the period-end day, for the §6 variance check.
    prisma.cashRecon.findFirst({
      where: { date: utcDayRange(to), outletId: outletId ?? undefined, verifiedAmount: { not: null } },
      orderBy: { date: 'desc' },
      select: { verifiedAmount: true, closingBalance: true, verifiedBy: true },
    }),
  ])

  const cashCollected = coll._sum.cash || 0
  const paidBillsCash = paid._sum.amountPaid || 0
  const cashExpenses = (petty._sum.amount || 0) + (expensePayments._sum.amount || 0)

  const debited = roundMoney(cashCollected + paidBillsCash)
  const spent = roundMoney(cashExpenses)
  const closing = roundMoney(opening + debited - spent)

  let variance: CustodianVariance
  if (endRecon?.verifiedAmount != null) {
    const diff = roundMoney(endRecon.verifiedAmount - closing)
    variance = Math.abs(diff) > 0.005
      ? { status: 'MISMATCH', note: `Physically counted ${roundMoney(endRecon.verifiedAmount).toLocaleString()} on the closing day vs a computed ${closing.toLocaleString()}.`, recordedBalance: roundMoney(endRecon.verifiedAmount), difference: diff }
      : { status: 'RECONCILED', note: 'The computed closing matches the officer-verified physical count on the closing day.', recordedBalance: roundMoney(endRecon.verifiedAmount), difference: 0 }
  } else {
    variance = { status: 'UNVERIFIABLE', note: 'No verified physical cash count recorded for the period-end day, so the computed closing can’t be independently confirmed.', recordedBalance: null, difference: null }
  }

  return { opening, debited, spent, closing, variance }
}

/**
 * Digital Expenses (BANK/MOBILE_MONEY/CARD): the balance reads live from the
 * wrapped account's GL. Phase A can therefore give an exact Closing and an exact
 * Spent (ExpensePayment sum for the period), but Opening is back-derived and
 * Debited is 0 — deposits-by-cashiers / internal top-up transfers / withdrawals
 * are not yet a tracked transaction type (Phase B, §9.1). Flagged UNVERIFIABLE
 * so the report never implies a verification that hasn't happened.
 */
async function computeDigitalPeriod(
  source: { id: string; sourceType: string; currentBalance: number; companyPaymentAccountId: string | null; outletId: string | null },
  from: Date,
  to: Date,
): Promise<FundPeriod> {
  const [closing, paymentsAgg] = await Promise.all([
    getFundingSourceBalance(prisma, source),
    prisma.expensePayment.aggregate({ where: { fundingSourceId: source.id, paidAt: { gte: from, lte: to } }, _sum: { amount: true } }),
  ])
  const spent = roundMoney(paymentsAgg._sum.amount || 0)
  const debited = 0 // Phase B: deposits by cashiers + internal top-up transfers + other credits.
  const opening = roundMoney(closing - debited + spent) // back-derived so the identity holds.

  return {
    opening,
    debited,
    spent,
    closing: roundMoney(closing),
    variance: {
      status: 'UNVERIFIABLE',
      note: 'Digital balance reads live from the linked account’s GL. Per-account deposits, internal top-up transfers and withdrawals arrive in Phase B — until then Opening is inferred and money-in isn’t itemised.',
      recordedBalance: null,
      difference: null,
    },
  }
}

/**
 * The whole Custodian Report for a period. One row per in-scope FundingSource
 * (the actual custodial unit — each fund row has one outlet, one fund class and
 * its own custodian(s)), plus the §4 per-fund-class summaries and combined card.
 */
export async function buildCustodianReport(params: CustodianReportParams): Promise<CustodianReport> {
  const { from, to } = params

  // Active, non-archived funds only — the same visibility the ledger screens use.
  const sources = await prisma.fundingSource.findMany({
    where: { isActive: true, archived: false },
    select: {
      id: true, name: true, sourceType: true, currentBalance: true,
      companyPaymentAccountId: true, outletId: true, responsibleUserId: true,
    },
    orderBy: { name: 'asc' },
  })

  // Keep only funds that (a) map to a fund class (OTHER is none of the three —
  // §5), (b) match the outlet scope, and (c) match the fund-class filter.
  const inScope = sources.filter((s) => {
    const fc = fundClassOf(s.sourceType)
    if (!fc) return false
    if (params.fundClass && fc !== params.fundClass) return false
    if (params.outletId && s.outletId !== params.outletId) return false
    return true
  })

  // Batch-resolve custodian names and outlet names once.
  const custodianRows = inScope.length
    ? await prisma.fundingSourceCustodian.findMany({
        where: { fundingSourceId: { in: inScope.map((s) => s.id) } },
        select: { fundingSourceId: true, userId: true },
      })
    : []
  const custodianIdsBySource = new Map<string, string[]>()
  for (const s of inScope) {
    const assigned = custodianRows.filter((c) => c.fundingSourceId === s.id).map((c) => c.userId)
    // Fall back to the legacy single responsibleUserId when no M:N assignment.
    const ids = [...new Set([...assigned, ...(s.responsibleUserId ? [s.responsibleUserId] : [])])]
    custodianIdsBySource.set(s.id, ids)
  }
  const allUserIds = [...new Set([...custodianIdsBySource.values()].flat())]
  const allOutletIds = [...new Set(inScope.map((s) => s.outletId).filter((id): id is string => !!id))]
  const [users, outlets] = await Promise.all([
    allUserIds.length ? prisma.user.findMany({ where: { id: { in: allUserIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    allOutletIds.length ? prisma.outlet.findMany({ where: { id: { in: allOutletIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ])
  const userName = new Map(users.map((u) => [u.id, u.name]))
  const outletName = (id: string | null) => (id ? outlets.find((o) => o.id === id)?.name || 'Unknown outlet' : 'Unassigned')

  const rows: CustodianReportRow[] = []
  for (const s of inScope) {
    const fundClass = fundClassOf(s.sourceType) as FundClass
    let period: FundPeriod
    if (fundClass === 'CASHIER_CASH') period = await computeCashierDrawerPeriod(s.outletId, from, to)
    else if (fundClass === 'DIGITAL') period = await computeDigitalPeriod(s, from, to)
    else period = await computeCashLedgerPeriod(s, from, to)

    const custodianUserIds = custodianIdsBySource.get(s.id) || []
    const custodianName = custodianUserIds.length
      ? custodianUserIds.map((id) => userName.get(id) || 'Unknown').join(', ')
      : 'Unassigned'

    rows.push({
      fundingSourceId: s.id,
      fundName: s.name,
      fundClass,
      fundClassLabel: FUND_CLASS_LABELS[fundClass],
      outletId: s.outletId,
      outletName: outletName(s.outletId),
      custodianName,
      custodianUserIds,
      opening: period.opening,
      debited: period.debited,
      spent: period.spent,
      closing: period.closing,
      variance: period.variance,
    })
  }

  // §4 summary cards — one per fund class, plus combined.
  const byFundClass = FUND_CLASSES.map((fc) => {
    const fcRows = rows.filter((r) => r.fundClass === fc)
    const totals = fcRows.reduce((t, r) => ({
      opening: roundMoney(t.opening + r.opening),
      debited: roundMoney(t.debited + r.debited),
      spent: roundMoney(t.spent + r.spent),
      closing: roundMoney(t.closing + r.closing),
    }), zeroTotals())
    return { fundClass: fc, label: FUND_CLASS_LABELS[fc], totals, flagged: fcRows.filter((r) => r.variance.status === 'MISMATCH').length }
  })

  const combined = rows.reduce((t, r) => ({
    opening: roundMoney(t.opening + r.opening),
    debited: roundMoney(t.debited + r.debited),
    spent: roundMoney(t.spent + r.spent),
    closing: roundMoney(t.closing + r.closing),
  }), zeroTotals())

  return {
    from,
    to,
    rows,
    byFundClass,
    combined,
    flaggedCount: rows.filter((r) => r.variance.status === 'MISMATCH').length,
  }
}
