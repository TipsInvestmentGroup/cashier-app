// The Petty Cash Ledger — graduates FundingSource.currentBalance from a
// materialized-only figure to a full transaction history (FundingSourceTxn),
// and resolves a FundingSource's live balance per its sourceType, including
// the new CASHIER_DRAWER type (Petty Cash Custodian scenario A: a cashier's
// available daily cash automatically IS the petty cash balance, no manual
// opening balance). See docs/expense-disbursement-framework-design.md Stage 16
// decision 2, which this extends rather than replaces.
import type { Db } from '@/lib/ledger'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { companyAccountBalance } from '@/lib/finance-banking'
import { computeAvailableCashToday } from '@/lib/cash-recon'
import { payableAmount } from '@/lib/expense-funds'

export interface FundingSourceLike {
  id: string
  sourceType: string
  currentBalance: number
  companyPaymentAccountId: string | null
  outletId: string | null
}

/** Resolves a FundingSource's current balance the way it's actually backed:
 *  CASH/OTHER materialize their own currentBalance; BANK/MOBILE_MONEY/CARD
 *  compute live from the wrapped CompanyPaymentAccount's GL balance;
 *  CASHIER_DRAWER computes live from that outlet's cash-recon position
 *  (lib/cash-recon.ts) — same "GL/operational figure is the single source of
 *  truth" principle Stage 16 decision 2 already established for bank sources. */
export async function getFundingSourceBalance(db: Db, source: FundingSourceLike): Promise<number> {
  if (source.sourceType === 'BANK' || source.sourceType === 'MOBILE_MONEY' || source.sourceType === 'CARD') {
    if (!source.companyPaymentAccountId) return 0
    return companyAccountBalance(db, source.companyPaymentAccountId)
  }
  if (source.sourceType === 'CASHIER_DRAWER') {
    return computeAvailableCashToday(source.outletId)
  }
  return source.currentBalance
}

export interface ReplenishFundingSourceInput {
  fundingSourceId: string
  amount: number
  reference?: string | null
  note?: string | null
  createdById: string
  createdByName?: string | null
}

export interface FundingSourceTxnInput {
  fundingSourceId: string
  type: string // OPEN | REPLENISH | PAYMENT | ADJUST
  amount: number // signed
  reference?: string | null
  note?: string | null
  expensePaymentId?: string | null
  createdById: string | null | undefined
  createdByName?: string | null
}

/**
 * The single choke point for EVERY Petty Cash Ledger write (FundingSourceTxn).
 *
 * SQLite cannot cleanly retrofit a NOT NULL constraint onto the already-
 * populated FundingSourceTxn.createdById column without a full table rebuild, so
 * the "no ledger write without an acting user" guarantee (Phase 1 of the
 * expense/petty-cash spec) is enforced HERE instead — every write path routes
 * through this function, and it refuses a write with no acting user id.
 *
 * It also GUARANTEES the denormalized name snapshot the "By" column reads:
 * callers that pass a name have it stored verbatim; callers that pass only an id
 * get the name resolved from the user record at write time. This is what fixes
 * the reported "By: —" on Expense-paid rows — the PAYMENT write previously
 * stored createdById but no createdByName, and the ledger renders the name.
 *
 * Runs on the passed `db` so it composes inside a caller's transaction.
 */
export async function writeFundingSourceTxn(db: Db, input: FundingSourceTxnInput) {
  if (!input.createdById) {
    throw new Error('Ledger write blocked: every petty cash ledger entry must record the acting user')
  }
  let createdByName = input.createdByName?.trim() || null
  if (!createdByName) {
    const actor = await db.user.findUnique({ where: { id: input.createdById }, select: { name: true } })
    createdByName = actor?.name?.trim() || null
  }
  if (!createdByName) {
    throw new Error('Ledger write blocked: could not resolve a name for the acting user')
  }
  return db.fundingSourceTxn.create({
    data: {
      fundingSourceId: input.fundingSourceId,
      type: input.type,
      amount: input.amount,
      reference: input.reference || null,
      note: input.note || null,
      expensePaymentId: input.expensePaymentId || null,
      createdById: input.createdById,
      createdByName,
      // createdAt is a server-side @default(now()) — never a client clock.
    },
  })
}

/**
 * The credit half of the ledger — a REPLENISH row + a materialized-balance bump,
 * on the passed `db` so it composes inside a caller's transaction (the §8 top-up
 * allocation runs inside the approval-decide transaction and must NOT open a
 * nested one). CASH/OTHER only, same guard as before. `expensePaymentId` is
 * reused as a loose ref back to the ExpenseRequest that triggered the credit
 * (top-ups have no ExpensePayment of their own), so the ledger row is traceable.
 */
export async function creditFundingSource(db: Db, input: ReplenishFundingSourceInput & { expenseRequestId?: string | null }) {
  const amount = roundMoney(input.amount)
  if (amount <= 0) throw new Error('Amount must be greater than zero')

  const source = await db.fundingSource.findUnique({ where: { id: input.fundingSourceId } })
  if (!source || !source.isActive) throw new Error('Funding source not found or inactive')
  if (source.sourceType !== 'CASH' && source.sourceType !== 'OTHER') {
    throw new Error(`${source.sourceType} funding sources are not replenished this way — their balance is always computed live`)
  }

  await writeFundingSourceTxn(db, {
    fundingSourceId: source.id, type: 'REPLENISH', amount,
    reference: input.reference, note: input.note,
    expensePaymentId: input.expenseRequestId,
    createdById: input.createdById, createdByName: input.createdByName,
  })
  return db.fundingSource.update({
    where: { id: source.id },
    data: { currentBalance: roundMoney(source.currentBalance + amount) },
  })
}

/** Allocates funds to a custodian (Petty Cash Ledger scenario B's "Funds
 *  Received"). CASH/OTHER only — CASHIER_DRAWER's balance always follows the
 *  cashier's daily cash automatically, and BANK/MOBILE_MONEY/CARD balances
 *  follow their GL account, so "replenishing" either would be meaningless.
 *  Owns its own transaction; the tx-aware core is creditFundingSource above. */
export async function replenishFundingSource(input: ReplenishFundingSourceInput) {
  return prisma.$transaction((tx) => creditFundingSource(tx, input))
}

export interface LedgerRow {
  id: string
  type: string
  amount: number
  reference: string | null
  note: string | null
  createdById: string | null
  createdByName: string | null
  createdAt: Date
  runningBalance: number
  // ── Phase 5 (ledger request context) ──
  // Populated by attachRequestContext for rows traceable to an ExpenseRequest:
  // a PAYMENT row via its ExpensePayment → PaymentAllocation → request, and a
  // top-up REPLENISH row via the request id carried in expensePaymentId. Absent
  // (all null/undefined) on OPEN, ADJUST, and admin-override allocations.
  requestNumber?: string | null
  employeeName?: string | null
  department?: string | null
  paymentMethod?: string | null
  // requestedAmount = ExpenseRequest.amount; approvedAmount = the allocated
  // figure (allocatedAmount ?? amount). They diverge on a partial approval —
  // an approver signing off a smaller cheque than requested — which is exactly
  // what the two columns surface.
  requestedAmount?: number | null
  approvedAmount?: number | null
  // >1 when a single ExpensePayment settled several requests, so the single
  // "linked request #" cell can say "EXP-… +N more" instead of hiding the rest.
  multiRequestCount?: number
}

interface LedgerRequestContext {
  requestNumber: string | null
  employeeName: string | null
  department: string | null
  paymentMethod: string | null
  requestedAmount: number | null
  approvedAmount: number | null
  multiRequestCount: number
}

/**
 * Resolves the Phase 5 request context (linked request #, employee, department,
 * payment method, requested vs approved amount) for a batch of ledger txns, in
 * a fixed handful of queries regardless of row count.
 *
 * Two link shapes exist, both keyed off FundingSourceTxn.expensePaymentId:
 *  - PAYMENT rows point at an ExpensePayment (its paymentMethod + its
 *    PaymentAllocations → the settled ExpenseRequest(s)).
 *  - Top-up REPLENISH rows reuse the field as a loose ref to the ExpenseRequest
 *    that was allocated (see creditFundingSource), which has no payment of its
 *    own — payment method is left null there.
 * OPEN / ADJUST / admin-override rows carry no ref and get no context.
 *
 * Employee and department names are batch-resolved from their ids (both are
 * loose scalar refs on ExpenseRequest, not relations) so a row shows the person
 * and cost-centre, not a cuid.
 */
export async function buildLedgerRequestContext(
  db: Db,
  txns: { id: string; type: string; expensePaymentId: string | null }[],
): Promise<Map<string, LedgerRequestContext>> {
  const paymentIds = txns.filter((t) => t.type === 'PAYMENT' && t.expensePaymentId).map((t) => t.expensePaymentId as string)
  const topUpReqIds = txns.filter((t) => t.type === 'REPLENISH' && t.expensePaymentId).map((t) => t.expensePaymentId as string)

  const payments = paymentIds.length
    ? await db.expensePayment.findMany({
        where: { id: { in: paymentIds } },
        select: {
          id: true, paymentMethod: true,
          allocations: {
            select: {
              expenseRequest: { select: { id: true, requestNumber: true, requestedById: true, departmentId: true, amount: true, allocatedAmount: true } },
            },
          },
        },
      })
    : []

  const topUpReqs = topUpReqIds.length
    ? await db.expenseRequest.findMany({
        where: { id: { in: topUpReqIds } },
        select: { id: true, requestNumber: true, requestedById: true, departmentId: true, amount: true, allocatedAmount: true },
      })
    : []

  // Batch-resolve the loose scalar refs (employee id, department id) once.
  const userIds = new Set<string>()
  const deptIds = new Set<string>()
  const collect = (r: { requestedById: string; departmentId: string | null }) => { userIds.add(r.requestedById); if (r.departmentId) deptIds.add(r.departmentId) }
  for (const p of payments) for (const a of p.allocations) collect(a.expenseRequest)
  for (const r of topUpReqs) collect(r)

  const [users, depts] = await Promise.all([
    userIds.size ? db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : Promise.resolve([]),
    deptIds.size ? db.department.findMany({ where: { id: { in: [...deptIds] } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ])
  const userName = new Map(users.map((u) => [u.id, u.name]))
  const deptName = new Map(depts.map((d) => [d.id, d.name]))

  const reqContext = (r: { requestNumber: string | null; requestedById: string; departmentId: string | null; amount: number; allocatedAmount: number | null }) => ({
    requestNumber: r.requestNumber,
    employeeName: userName.get(r.requestedById) ?? null,
    department: r.departmentId ? deptName.get(r.departmentId) ?? null : null,
    requestedAmount: r.amount,
    approvedAmount: r.allocatedAmount ?? r.amount,
  })

  const byPaymentId = new Map(payments.map((p) => [p.id, p]))
  const byReqId = new Map(topUpReqs.map((r) => [r.id, r]))

  const out = new Map<string, LedgerRequestContext>()
  for (const t of txns) {
    if (t.type === 'PAYMENT' && t.expensePaymentId) {
      const p = byPaymentId.get(t.expensePaymentId)
      if (!p) continue
      const reqs = p.allocations.map((a) => a.expenseRequest)
      const first = reqs[0]
      out.set(t.id, {
        ...(first ? reqContext(first) : { requestNumber: null, employeeName: null, department: null, requestedAmount: null, approvedAmount: null }),
        paymentMethod: p.paymentMethod,
        multiRequestCount: reqs.length,
      })
    } else if (t.type === 'REPLENISH' && t.expensePaymentId) {
      const r = byReqId.get(t.expensePaymentId)
      if (!r) continue
      out.set(t.id, { ...reqContext(r), paymentMethod: null, multiRequestCount: 1 })
    }
  }
  return out
}

/** Merges the resolved request context onto ledger rows (by row id), leaving
 *  rows with no linked request untouched. Kept separate from listFundingSource-
 *  Ledger so the live-balance branch (which builds its own rows) can reuse it. */
export function mergeRequestContext(rows: LedgerRow[], ctx: Map<string, LedgerRequestContext>): LedgerRow[] {
  return rows.map((r) => {
    const c = ctx.get(r.id)
    return c ? { ...r, ...c } : r
  })
}

export interface FundingSourceLedger {
  fundingSourceId: string
  openingBalance: number
  totalReceived: number
  totalPaid: number
  closingBalance: number
  rows: LedgerRow[]
}

/** Full ledger for one CASH/OTHER funding source: opening balance, every
 *  FundingSourceTxn in date order with a running balance, and the
 *  Opening/Received/Paid/Closing summary the Petty Cash Ledger screen shows
 *  (Petty Cash Custodian scenario B's exact requested figures). Not meaningful
 *  for CASHIER_DRAWER/BANK/MOBILE_MONEY/CARD sources, whose balance is always
 *  read live rather than accumulated from a ledger — callers should use
 *  getFundingSourceBalance for those instead. */
export async function listFundingSourceLedger(fundingSourceId: string): Promise<FundingSourceLedger> {
  const source = await prisma.fundingSource.findUniqueOrThrow({ where: { id: fundingSourceId } })
  const txns = await prisma.fundingSourceTxn.findMany({ where: { fundingSourceId }, orderBy: { createdAt: 'asc' } })

  // The effective starting point for the running balance is derived from
  // currentBalance backward, not the stored openingBalance field — a funding
  // source that had payments before this ledger existed (e.g. seeded from a
  // legacy PettyFund) has "missing" history that would otherwise make the
  // running balance drift from the real currentBalance. Deriving it this way
  // keeps every row's running balance reconciling to currentBalance exactly,
  // with the gap (if any) implicitly absorbed into the displayed opening
  // figure rather than silently misstating the closing balance.
  const txnTotal = roundMoney(txns.reduce((s, t) => s + t.amount, 0))
  const effectiveOpening = roundMoney(source.currentBalance - txnTotal)

  let running = effectiveOpening
  const rows: LedgerRow[] = txns.map((t) => {
    running = roundMoney(running + t.amount)
    return { id: t.id, type: t.type, amount: t.amount, reference: t.reference, note: t.note, createdById: t.createdById, createdByName: t.createdByName, createdAt: t.createdAt, runningBalance: running }
  })

  const totalReceived = roundMoney(txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0))
  const totalPaid = roundMoney(txns.filter((t) => t.amount < 0).reduce((s, t) => s + -t.amount, 0))

  // Phase 5: attach linked-request context (request #, employee, department,
  // payment method, requested vs approved amount) before handing rows to the UI.
  const ctx = await buildLedgerRequestContext(prisma, txns)

  return {
    fundingSourceId,
    openingBalance: effectiveOpening,
    totalReceived,
    totalPaid,
    closingBalance: source.currentBalance,
    rows: mergeRequestContext(rows.reverse(), ctx), // most recent first, for the screen
  }
}

export interface FundingSourceMetrics {
  /** Σ outstanding (amount − paid) of this fund's APPROVED/PARTIALLY_PAID OUT
   *  requests — money committed but not yet disbursed. */
  reserved: number
  /** closingBalance − reserved: what is actually free to spend. */
  available: number
  /** The fund's stored low-balance threshold (0 = no threshold configured). */
  lowBalanceThreshold: number
  /** closingBalance < a configured threshold → surface the "Top-up Required" badge. */
  topUpRequired: boolean
  /** Rolling 14-day average of Expenses Paid (14-day window, not 7, so one large
   *  expense doesn't distort it — the spec's explicit choice). */
  avgDailySpend: number
  /** Days of ledger history for this fund (earliest txn → now). */
  historyDays: number
  /** available ÷ avgDailySpend, or null when it would be meaningless — no spend,
   *  or fewer than 5 days of history (avoids a nonsense "∞ days" / early noise). */
  daysUntilEmpty: number | null
}

const AVG_WINDOW_DAYS = 14
const MIN_HISTORY_DAYS = 5
const DAY_MS = 86_400_000

/**
 * The Reserved / Available / Top-up-required / burn-rate figures the Petty Cash
 * Ledger screen shows beside the balance. Computed for ANY funding source
 * (materialized CASH or live CASHIER_DRAWER/BANK) — the caller passes the
 * already-resolved closingBalance so this doesn't re-resolve it. `nowMs` is
 * injectable for deterministic tests.
 *
 * avgDailySpend is derived from PAYMENT ledger rows, which only exist for
 * CASH/CASHIER_DRAWER funds (bank/mobile-money balances move in the GL, not
 * here) — so a bank-backed fund reports 0 spend and a suppressed days-to-empty
 * rather than a wrong number.
 */
export async function computeFundingSourceMetrics(
  db: Db,
  source: { id: string; lowBalanceThreshold: number },
  closingBalance: number,
  nowMs: number = Date.now(),
): Promise<FundingSourceMetrics> {
  const openReqs = await db.expenseRequest.findMany({
    where: { fundingSourceId: source.id, direction: 'OUT', status: { in: ['APPROVED', 'PARTIALLY_PAID'] } },
    select: { amount: true, allocatedAmount: true, paymentAllocations: { select: { amount: true } } },
  })
  const reserved = roundMoney(openReqs.reduce((s, r) => {
    const paid = r.paymentAllocations.reduce((a, p) => a + p.amount, 0)
    // Reserve against the APPROVED figure, not the requested one — a request
    // approved for less commits only what was approved.
    return s + Math.max(0, payableAmount(r) - paid)
  }, 0))
  const available = roundMoney(closingBalance - reserved)

  const since = new Date(nowMs - AVG_WINDOW_DAYS * DAY_MS)
  const payTxns = await db.fundingSourceTxn.findMany({
    where: { fundingSourceId: source.id, type: 'PAYMENT', createdAt: { gte: since } },
    select: { amount: true },
  })
  const spentInWindow = payTxns.reduce((s, t) => s + Math.abs(t.amount), 0)
  const avgDailySpend = roundMoney(spentInWindow / AVG_WINDOW_DAYS)

  const first = await db.fundingSourceTxn.findFirst({
    where: { fundingSourceId: source.id },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })
  const historyDays = first ? Math.floor((nowMs - first.createdAt.getTime()) / DAY_MS) : 0

  const daysUntilEmpty = avgDailySpend > 0 && historyDays >= MIN_HISTORY_DAYS && available > 0
    ? Math.floor(available / avgDailySpend)
    : null

  return {
    reserved,
    available,
    lowBalanceThreshold: source.lowBalanceThreshold,
    topUpRequired: source.lowBalanceThreshold > 0 && closingBalance < source.lowBalanceThreshold,
    avgDailySpend,
    historyDays,
    daysUntilEmpty,
  }
}
