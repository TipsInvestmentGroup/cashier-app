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

/** §2.1 per-account movement breakdown for a Digital Expenses fund. Each digital
 *  FundingSource wraps exactly one CompanyPaymentAccount, so one report row = one
 *  bank/channel account, and this is that account's money movement for the
 *  period, derived from the GL (the single source of truth) — deposits by
 *  cashiers, internal transfers funding top-ups, withdrawals, disbursements. */
export interface DigitalAccountDetail {
  accountLabel: string
  /** Masked account number (last 4), or null when none is on file. */
  accountMasked: string | null
  channel: string | null
  depositsByCashiers: number
  internalTransfersOut: number
  withdrawals: number
  disbursements: number
  otherCredits: number
  otherOut: number
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
  /** Present only on Digital rows (§2.1 per-account expansion). */
  accountDetail?: DigitalAccountDetail
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

/** Last-4 account masking. No such convention existed in the app before this
 *  report, so this establishes it: exports and the UI show "••••1234", never a
 *  full account number (Spec v2 §9.1 item 4). */
export function maskAccountNumber(num: string | null | undefined): string | null {
  if (!num) return null
  const trimmed = num.trim()
  if (trimmed.length <= 4) return trimmed
  return `••••${trimmed.slice(-4)}`
}

interface FundPeriod {
  opening: number
  debited: number
  spent: number
  closing: number
  variance: CustodianVariance
  accountDetail?: DigitalAccountDetail
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

interface DigitalAccountInfo {
  companyPaymentAccountId: string
  glAccountId: string
  accountName: string
  bankName: string | null
  accountNumber: string | null
  channel: string | null
}

/**
 * Digital Expenses (BANK/MOBILE_MONEY/CARD) — Phase B (§2.1). The wrapped
 * account's balance IS its GL account's ledger balance (companyAccountBalance),
 * so everything is derived from JournalLines against that GL account — the
 * single source of truth — never a parallel ledger:
 *   opening  = Σ(debit − credit) for entries dated before `from`
 *   closing  = opening + Σ(period net)   (identity holds exactly)
 * Period movements are classified into the §9.1 buckets by the JournalEntry that
 * produced them:
 *   money IN  (debit): COLLECTIONS  → deposits by cashiers; else → other credits
 *   money OUT (credit): EXPENSE (ExpensePayment) → disbursements;
 *                       BankTransaction TRANSFER → internal transfer (top-up funding);
 *                       BankTransaction WITHDRAWAL → withdrawal; else → other out
 *   Debited = deposits + other credits;  Spent = disbursements + transfers +
 *   withdrawals + other out.
 * Variance (§6): the balance ties to the GL/bank by construction, so the
 * meaningful gap is disbursements still lacking proof of payment (same test the
 * §6 reconciliation route uses for digital funds).
 */
async function computeDigitalPeriod(
  source: { id: string },
  account: DigitalAccountInfo | null,
  from: Date,
  to: Date,
): Promise<FundPeriod> {
  // A digital fund with no wrapped account can't have a GL-derived balance —
  // fall back to zeros rather than guessing (shouldn't happen for a live fund).
  if (!account) {
    return { opening: 0, debited: 0, spent: 0, closing: 0, variance: { status: 'UNVERIFIABLE', note: 'This digital fund has no linked payment account, so no GL balance can be derived.', recordedBalance: null, difference: null } }
  }

  const [openingLines, periodLines, unverifiedCount] = await Promise.all([
    prisma.journalLine.findMany({ where: { accountId: account.glAccountId, journalEntry: { entryDate: { lt: from }, status: 'POSTED' } }, select: { debit: true, credit: true } }),
    prisma.journalLine.findMany({
      where: { accountId: account.glAccountId, journalEntry: { entryDate: { gte: from, lte: to }, status: 'POSTED' } },
      select: { debit: true, credit: true, journalEntry: { select: { sourceModule: true, sourceType: true, sourceId: true } } },
    }),
    prisma.expensePayment.count({ where: { fundingSourceId: source.id, paidAt: { gte: from, lte: to }, verificationId: null } }),
  ])

  const opening = roundMoney(openingLines.reduce((s, l) => s + l.debit - l.credit, 0))

  // Resolve BankTransaction types for the period's manual-sourced lines, so a
  // top-up transfer is told apart from a plain withdrawal.
  const bankTxnIds = [...new Set(periodLines.filter((l) => l.journalEntry.sourceType === 'BankTransaction' && l.journalEntry.sourceId).map((l) => l.journalEntry.sourceId as string))]
  const bankTxns = bankTxnIds.length
    ? await prisma.bankTransaction.findMany({ where: { id: { in: bankTxnIds } }, select: { id: true, type: true } })
    : []
  const bankTxnType = new Map(bankTxns.map((b) => [b.id, b.type]))

  let depositsByCashiers = 0, otherCredits = 0, disbursements = 0, internalTransfersOut = 0, withdrawals = 0, otherOut = 0
  for (const l of periodLines) {
    const je = l.journalEntry
    if (l.debit > 0) {
      if (je.sourceModule === 'COLLECTIONS') depositsByCashiers += l.debit
      else otherCredits += l.debit
    } else if (l.credit > 0) {
      if (je.sourceModule === 'EXPENSE') disbursements += l.credit
      else if (je.sourceType === 'BankTransaction') {
        const t = je.sourceId ? bankTxnType.get(je.sourceId) : undefined
        if (t === 'TRANSFER') internalTransfersOut += l.credit
        else if (t === 'WITHDRAWAL') withdrawals += l.credit
        else otherOut += l.credit
      } else otherOut += l.credit
    }
  }

  const debited = roundMoney(depositsByCashiers + otherCredits)
  const spent = roundMoney(disbursements + internalTransfersOut + withdrawals + otherOut)
  const closing = roundMoney(opening + debited - spent)

  const variance: CustodianVariance = unverifiedCount > 0
    ? { status: 'MISMATCH', note: `${unverifiedCount} digital disbursement(s) in the period still lack proof of payment.`, recordedBalance: closing, difference: 0 }
    : { status: 'RECONCILED', note: 'Balance reads live from the linked account’s GL and every disbursement has proof of payment.', recordedBalance: closing, difference: 0 }

  return {
    opening,
    debited,
    spent,
    closing,
    variance,
    accountDetail: {
      accountLabel: account.bankName ? `${account.accountName} — ${account.bankName}` : account.accountName,
      accountMasked: maskAccountNumber(account.accountNumber),
      channel: account.channel,
      depositsByCashiers: roundMoney(depositsByCashiers),
      internalTransfersOut: roundMoney(internalTransfersOut),
      withdrawals: roundMoney(withdrawals),
      disbursements: roundMoney(disbursements),
      otherCredits: roundMoney(otherCredits),
      otherOut: roundMoney(otherOut),
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
  // Wrapped payment accounts for the Digital funds in scope (§2.1 per-account
  // detail) — batch-resolved once, with the channel label joined.
  const digitalAccountIds = [...new Set(inScope.map((s) => s.companyPaymentAccountId).filter((id): id is string => !!id))]
  const [users, outlets, accounts] = await Promise.all([
    allUserIds.length ? prisma.user.findMany({ where: { id: { in: allUserIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    allOutletIds.length ? prisma.outlet.findMany({ where: { id: { in: allOutletIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    digitalAccountIds.length
      ? prisma.companyPaymentAccount.findMany({ where: { id: { in: digitalAccountIds } }, select: { id: true, glAccountId: true, accountName: true, bankName: true, accountNumber: true, paymentChannel: { select: { label: true } } } })
      : Promise.resolve([]),
  ])
  const userName = new Map(users.map((u) => [u.id, u.name]))
  const outletName = (id: string | null) => (id ? outlets.find((o) => o.id === id)?.name || 'Unknown outlet' : 'Unassigned')
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  const rows: CustodianReportRow[] = []
  for (const s of inScope) {
    const fundClass = fundClassOf(s.sourceType) as FundClass
    let period: FundPeriod
    if (fundClass === 'CASHIER_CASH') period = await computeCashierDrawerPeriod(s.outletId, from, to)
    else if (fundClass === 'DIGITAL') {
      const acc = s.companyPaymentAccountId ? accountById.get(s.companyPaymentAccountId) : null
      period = await computeDigitalPeriod(s, acc ? {
        companyPaymentAccountId: acc.id, glAccountId: acc.glAccountId, accountName: acc.accountName,
        bankName: acc.bankName, accountNumber: acc.accountNumber, channel: acc.paymentChannel?.label ?? null,
      } : null, from, to)
    }
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
      accountDetail: period.accountDetail,
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

// ─── Daily Custodian Movement Report (Spec v2 §7 / §9.2) ────────────────────
// A single-day, distributable snapshot built to be emailed to directors. It is
// the Custodian Report's numbers (reused verbatim via buildCustodianReport with
// from=to=the day) PLUS a compact list of the day's actual transactions, so a
// director sees not just the totals but what moved and to whom.

export interface DailyTxn {
  time: string // ISO timestamp
  fundClass: FundClass
  fundClassLabel: string
  fundName: string
  description: string
  amount: number // signed: + received into custody, − paid out
  party: string // payee (disbursement) or the person who actioned it (top-up)
  kind: 'disbursement' | 'topup'
}

export interface DailyCustodianMovement {
  date: Date
  report: CustodianReport
  transactions: DailyTxn[]
}

/**
 * Assembles the daily report. Numbers come from buildCustodianReport (no
 * duplicated balance logic — §9.2 item 5). The transaction list is the day's
 * ExpensePayments (money out) and top-up REPLENISH ledger rows (money into a
 * fund), scoped to the same outlet, newest first.
 */
export async function buildDailyCustodianMovement(date: Date, outletId?: string | null): Promise<DailyCustodianMovement> {
  // Window the day in UTC, matching how the date columns are stored and how the
  // cashier path (lib/cash-recon.ts) windows — using local setHours() here would
  // shift a non-UTC host's day and, combined with cash-recon's UTC windowing,
  // silently widen a single day into two. Deriving the UTC bounds from the
  // date's *local* y/m/d (which is the calendar date the user picked, however
  // the string was parsed) is host-independent.
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate()
  const from = new Date(Date.UTC(y, m, d, 0, 0, 0, 0))
  const to = new Date(Date.UTC(y, m, d, 23, 59, 59, 999))

  const report = await buildCustodianReport({ from, to, outletId })

  const range = { gte: from, lte: to }
  const paymentWhere: Record<string, unknown> = { paidAt: range }
  if (outletId) paymentWhere.fundingSource = { outletId }

  const [payments, topupTxns] = await Promise.all([
    prisma.expensePayment.findMany({
      where: paymentWhere,
      select: {
        amount: true, paidAt: true, payeeName: true,
        fundingSource: { select: { name: true, sourceType: true, outletId: true } },
        allocations: { select: { expenseRequest: { select: { purpose: true, requestedById: true } } } },
      },
      orderBy: { paidAt: 'desc' },
    }),
    prisma.fundingSourceTxn.findMany({
      where: { type: 'REPLENISH', createdAt: range },
      select: {
        amount: true, createdAt: true, note: true, reference: true, createdByName: true,
        fundingSource: { select: { name: true, sourceType: true, outletId: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // Resolve requester names for payments that carry no explicit payee.
  const reqIds = [...new Set(payments.flatMap((p) => p.allocations.map((a) => a.expenseRequest.requestedById)))]
  const reqUsers = reqIds.length ? await prisma.user.findMany({ where: { id: { in: reqIds } }, select: { id: true, name: true } }) : []
  const reqName = new Map(reqUsers.map((u) => [u.id, u.name]))

  const transactions: DailyTxn[] = []
  for (const p of payments) {
    const fc = fundClassOf(p.fundingSource.sourceType)
    if (!fc) continue
    if (outletId && p.fundingSource.outletId !== outletId) continue
    const first = p.allocations[0]?.expenseRequest
    transactions.push({
      time: p.paidAt.toISOString(),
      fundClass: fc,
      fundClassLabel: FUND_CLASS_LABELS[fc],
      fundName: p.fundingSource.name,
      description: first?.purpose || 'Expense payment',
      amount: roundMoney(-p.amount),
      party: p.payeeName || (first ? reqName.get(first.requestedById) || '—' : '—'),
      kind: 'disbursement',
    })
  }
  for (const t of topupTxns) {
    const fc = fundClassOf(t.fundingSource.sourceType)
    if (!fc) continue
    if (outletId && t.fundingSource.outletId !== outletId) continue
    transactions.push({
      time: t.createdAt.toISOString(),
      fundClass: fc,
      fundClassLabel: FUND_CLASS_LABELS[fc],
      fundName: t.fundingSource.name,
      description: t.note || t.reference || 'Top-up / replenishment',
      amount: roundMoney(t.amount),
      party: t.createdByName || '—',
      kind: 'topup',
    })
  }
  transactions.sort((a, b) => (a.time < b.time ? 1 : -1))

  return { date, report, transactions }
}
