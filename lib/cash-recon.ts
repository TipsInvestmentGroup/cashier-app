// Shared cash-position arithmetic, extracted from app/api/cash-recon/route.ts
// so lib/expense-ledger.ts's CASHIER_DRAWER balance (Petty Cash Custodian
// scenario A) can read the exact same "cashier's available cash today"
// figure the Cash Reconciliation screen already computes, instead of a
// second, divergent formula.
import { prisma } from '@/lib/prisma'
import { resolveEffectiveConfig, resolveBusinessDate } from '@/lib/business-calendar'

// ─── Timezone-safe day windowing ───────────────────────────────────────────
// DailyCollection.date, PaidBill.date, PettyCash.date and CashRecon.date are all
// persisted as `new Date('yyyy-MM-dd')` — i.e. UTC midnight of the business
// calendar date. So we must window them in UTC. date-fns startOfDay/endOfDay use
// the HOST's local zone, which ties out on a UTC host (prod/Vercel) but drifts a
// whole day on any non-UTC host (a local dev machine in EAT, a non-UTC region),
// silently counting a day's collections under the wrong day. UTC windowing is
// host-independent and matches how the column is stored on every host.

/** [00:00, 23:59.999] UTC of `day`'s UTC calendar date. `day` must be a
 *  UTC-midnight instant (as produced by `new Date('yyyy-MM-dd')` or
 *  `businessTodayUtc`) so the UTC getters read back the intended date. */
export function utcDayRange(day: Date) {
  const y = day.getUTCFullYear(), m = day.getUTCMonth(), d = day.getUTCDate()
  return { gte: new Date(Date.UTC(y, m, d, 0, 0, 0, 0)), lte: new Date(Date.UTC(y, m, d, 23, 59, 59, 999)) }
}

/** Start (UTC midnight) of `day`'s UTC calendar date. */
export function utcDayStart(day: Date): Date {
  return utcDayRange(day).gte
}

/** The current *business* date for an outlet, normalized to UTC midnight so it
 *  windows against the stored date columns correctly. resolveBusinessDate already
 *  applies the outlet's timezone + cutover (a moment before the cutover belongs to
 *  the previous date), fixing the old `new Date()` raw-clock reads that attributed
 *  pre-cutover activity to the wrong day. */
export async function businessTodayUtc(outletId?: string | null): Promise<Date> {
  const effective = await resolveEffectiveConfig({ outletId: outletId || undefined })
  const local = resolveBusinessDate(new Date(), effective)
  return new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, 0))
}

/** Yesterday's (or the most recent prior) closing balance becomes today's opening.
 *  Floored at 0: a physical cash drawer cannot open with negative cash. A prior
 *  day whose closing went negative (e.g. a deposit recorded larger than the cash
 *  actually collected — usually because that day's collection was never entered)
 *  must NOT carry that impossible negative forward, or it compounds by another
 *  −deposit every subsequent day. Any real shortfall is a receivable tracked in
 *  Excess Recon, not negative cash in the till. The offending day still shows its
 *  own negative closing (surfaced with a warning on the form) — it just doesn't
 *  poison the next day's opening. */
export async function previousClosing(day: Date, outletId?: string | null): Promise<number> {
  const prev = await prisma.cashRecon.findFirst({
    where: { date: { lt: utcDayStart(day) }, outletId: outletId || null },
    orderBy: { date: 'desc' },
  })
  return Math.max(0, prev?.closingBalance || 0)
}

/** Computed cash figures for a business day + outlet (collected / paid-cash /
 *  expenses). `day` is any instant on the target business date, normalized to a
 *  UTC day window internally (see the windowing note above). */
export async function computeCash(day: Date, outletId?: string | null) {
  const range = utcDayRange(day)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = { date: range }
  if (outletId) f.outletId = outletId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fundingSourceFilter: any = { sourceType: { in: ['CASH', 'CASHIER_DRAWER'] } }
  if (outletId) fundingSourceFilter.outletId = outletId
  const [coll, paid, petty, expensePayments] = await Promise.all([
    prisma.dailyCollection.aggregate({ where: f, _sum: { cash: true } }),
    prisma.paidBill.aggregate({ where: { ...f, paymentMethod: 'CASH' }, _sum: { amountPaid: true } }),
    // Only cash actually disbursed from the cashier's drawer reduces it — paid,
    // CASH, and drawn from the cashier fund (accountant-fund payments don't count).
    prisma.pettyCash.aggregate({ where: { ...f, paymentMethod: 'CASH', paymentStatus: 'PAID', pettyType: 'CASHIER' }, _sum: { amount: true } }),
    // Same cash-drawer disbursements, but made through the new Expense &
    // Disbursement Framework's ExpensePayment table instead of legacy PettyCash
    // — without this, cash paid out via the new framework's Pay flow would
    // never reduce the drawer here, letting it be spent twice.
    prisma.expensePayment.aggregate({ where: { paidAt: range, fundingSource: fundingSourceFilter }, _sum: { amount: true } }),
  ])
  return {
    cashCollected: coll._sum.cash || 0,
    paidBillsCash: paid._sum.amountPaid || 0,
    cashExpenses: (petty._sum.amount || 0) + (expensePayments._sum.amount || 0),
  }
}

/** Today's available cash for an outlet (or all outlets), same formula the
 *  Cash Reconciliation screen posts: opening + collected + paidCash - cashExpenses.
 *  Deliberately excludes cashDeposited/excess (those are entered only when a
 *  cashier actually reconciles for the day) — this is a live running figure,
 *  not a finalized reconciliation. */
export async function computeAvailableCashToday(outletId?: string | null): Promise<number> {
  const today = await businessTodayUtc(outletId)
  const [opening, c] = await Promise.all([
    previousClosing(today, outletId),
    computeCash(today, outletId),
  ])
  return opening + c.cashCollected + c.paidBillsCash - c.cashExpenses
}
