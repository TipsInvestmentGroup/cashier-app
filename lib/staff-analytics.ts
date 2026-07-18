// Staff Data Insights & Analytics — Time-vs-Time, Day-over-Day, and
// Performance Trends for the Service Staff Dashboard (app/my-transactions).
// All bucketing is done in JS over plain rows (never DB date_trunc/GROUP BY),
// matching the established pattern in app/api/dashboard/growth/route.ts and
// app/api/reports/peak-heatmap/route.ts — this repo runs SQLite locally and
// Postgres in prod, and needs identical behavior on both.
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, subDays } from 'date-fns'

// Tanzania has no DST — EAT is a fixed UTC+3 (see peak-heatmap route).
// Exported so lib/bi/insights.ts's peak-hour insight reuses the same
// bucketing instead of a third copy of this hour-shift math.
export const EAT_OFFSET_MS = 3 * 60 * 60 * 1000
export const localHour = (d: Date) => new Date(d.getTime() + EAT_OFFSET_MS).getUTCHours()

export interface HourBucket { hour: number; label: string; amount: number; count: number; avgValue: number }

/**
 * Time-vs-Time: buckets one staff's session transactions by hour of day
 * (East Africa Time). "Sales" and "Collections" are the same figure in this
 * app today — a self-declared transaction IS the collection, there's no
 * separate system-level per-hour sales feed until MyPOS integration exists —
 * so this reports one Amount, not two identical columns.
 */
export async function getHourlyBreakdown(sessionId: string, staffId: string) {
  const transactions = await prisma.staffTransaction.findMany({
    where: { sessionId, staffId, status: { not: 'REJECTED' }, category: { in: ['PAYMENT', 'SIGNED_BILL', 'CREDIT_SALE'] } },
    select: { amount: true, createdAt: true },
  })

  const byHour = new Map<number, { amount: number; count: number }>()
  for (const t of transactions) {
    const h = localHour(t.createdAt)
    const cur = byHour.get(h) || { amount: 0, count: 0 }
    cur.amount += t.amount
    cur.count += 1
    byHour.set(h, cur)
  }

  const buckets: HourBucket[] = [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, v]) => ({
      hour, label: `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`,
      amount: roundMoney(v.amount), count: v.count, avgValue: v.count ? roundMoney(v.amount / v.count) : 0,
    }))

  const peakHour = buckets.length ? buckets.reduce((a, b) => (b.amount > a.amount ? b : a)) : null
  const slowHour = buckets.length ? buckets.reduce((a, b) => (b.amount < a.amount ? b : a)) : null

  return { buckets, peakHour, slowHour }
}

interface DayFigures {
  date: string
  total: number // official collection if validated, else declared total
  validated: boolean
  signedBills: number
  discounts: number
  cancellations: number
  dailyLoss: number | null
  transactionCount: number
  avgTransactionValue: number
}

/** Pulls one staff's figures for a single calendar day, from whichever
 *  source has the data — the official DailyCollection if validated, or the
 *  raw StaffTransaction declarations if the day is still in progress /
 *  wasn't run through Transaction Verification at all that day. */
async function dayFigures(outletId: string, staffName: string, staffId: string | null, date: Date): Promise<DayFigures> {
  const collection = await prisma.dailyCollection.findFirst({ where: { outletId, date, staffName } })
  if (collection) {
    const [signedBillsAgg, cancellationsAgg] = await Promise.all([
      prisma.signedBill.aggregate({ where: { serviceStaff: staffName, outletId, date, billType: { not: 'STAFF_LOSS' } }, _sum: { amount: true } }),
      prisma.cancellation.aggregate({ where: { collectionId: collection.id }, _sum: { amount: true } }),
    ])
    const dailyLoss = roundMoney(collection.systemSales - collection.total - collection.creditSales - collection.paymentsReceived - collection.discount)
    return {
      date: date.toISOString().slice(0, 10), total: collection.total, validated: true,
      signedBills: roundMoney(signedBillsAgg._sum.amount || 0), discounts: collection.discount,
      cancellations: roundMoney(cancellationsAgg._sum.amount || 0), dailyLoss,
      transactionCount: 0, avgTransactionValue: 0,
    }
  }

  if (!staffId) return { date: date.toISOString().slice(0, 10), total: 0, validated: false, signedBills: 0, discounts: 0, cancellations: 0, dailyLoss: null, transactionCount: 0, avgTransactionValue: 0 }

  const session = await prisma.transactionSession.findUnique({ where: { outletId_date: { outletId, date } } })
  if (!session) return { date: date.toISOString().slice(0, 10), total: 0, validated: false, signedBills: 0, discounts: 0, cancellations: 0, dailyLoss: null, transactionCount: 0, avgTransactionValue: 0 }

  const transactions = await prisma.staffTransaction.findMany({ where: { sessionId: session.id, staffId, status: { not: 'REJECTED' } } })
  const sum = (cats: string[]) => roundMoney(transactions.filter((t) => cats.includes(t.category)).reduce((s, t) => s + t.amount, 0))
  const salesTxns = transactions.filter((t) => ['PAYMENT', 'SIGNED_BILL', 'CREDIT_SALE'].includes(t.category))
  return {
    date: date.toISOString().slice(0, 10), total: sum(['PAYMENT', 'SIGNED_BILL', 'CREDIT_SALE']), validated: false,
    signedBills: sum(['SIGNED_BILL']), discounts: sum(['DISCOUNT']), cancellations: sum(['CANCELLATION']), dailyLoss: null,
    transactionCount: salesTxns.length, avgTransactionValue: salesTxns.length ? roundMoney(sum(['PAYMENT', 'SIGNED_BILL', 'CREDIT_SALE']) / salesTxns.length) : 0,
  }
}

const pctChange = (today: number, yesterday: number): number | null => {
  if (yesterday === 0) return today === 0 ? 0 : null // undefined % change off a zero base
  return Math.round(((today - yesterday) / yesterday) * 1000) / 10
}

/** Day-over-Day: today vs yesterday for one staff. `change` fields are
 *  percentages (null = yesterday was 0, so a % change isn't meaningful). */
export async function getDayOverDay(outletId: string, staffName: string, staffId: string | null, date: Date) {
  const [today, yesterday] = await Promise.all([
    dayFigures(outletId, staffName, staffId, date),
    dayFigures(outletId, staffName, staffId, subDays(date, 1)),
  ])
  return {
    today, yesterday,
    salesChangePct: pctChange(today.total, yesterday.total),
    avgTransactionChangePct: pctChange(today.avgTransactionValue, yesterday.avgTransactionValue),
    transactionsServed: today.transactionCount,
    transactionsServedYesterday: yesterday.transactionCount,
    signedBillsChangePct: pctChange(today.signedBills, yesterday.signedBills),
    discountsChangePct: pctChange(today.discounts, yesterday.discounts),
    cancellationsChangePct: pctChange(today.cancellations, yesterday.cancellations),
    dailyLossChangePct: today.dailyLoss !== null && yesterday.dailyLoss !== null ? pctChange(today.dailyLoss, yesterday.dailyLoss) : null,
  }
}

/** Performance Trends: last 7 / 30 days of official collection totals for
 *  one staff, from DailyCollection only (unvalidated in-progress days don't
 *  count toward a performance trend). */
export async function getPerformanceTrends(outletId: string, staffName: string, date: Date) {
  const from = startOfDay(subDays(date, 29))
  const rows = await prisma.dailyCollection.findMany({
    where: { outletId, staffName, date: { gte: from, lte: endOfDay(date) } },
    select: { date: true, total: true },
    orderBy: { date: 'asc' },
  })

  const series = rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), total: r.total }))
  const last7 = series.filter((r) => new Date(r.date) >= startOfDay(subDays(date, 6)))
  const last30 = series

  const summarize = (rows: { date: string; total: number }[]) => {
    if (!rows.length) return { average: 0, best: null as { date: string; total: number } | null, lowest: null as { date: string; total: number } | null }
    const average = roundMoney(rows.reduce((s, r) => s + r.total, 0) / rows.length)
    const best = rows.reduce((a, b) => (b.total > a.total ? b : a))
    const lowest = rows.reduce((a, b) => (b.total < a.total ? b : a))
    return { average, best, lowest }
  }

  return { series: last30, last7: summarize(last7), last30: summarize(last30) }
}
