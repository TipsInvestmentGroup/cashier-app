import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { summarizeStaffTransactions, staffDifference, splitChannelTotals } from '@/lib/staff-transaction-summary'
import { loadActiveTargets } from '@/lib/sales-targets'
import { targetLevels, targetDeptKey } from '@/lib/targets'
import { computeActuals } from '@/lib/target-actuals'
import { compare, targetAchievement, lossAttribution, peakHourInsight } from '@/lib/bi/insights'
import { getHourlyBreakdown } from '@/lib/staff-analytics'
import { startOfDay, endOfDay, subDays, parse, isValid } from 'date-fns'

// Prisma client types for BusinessSession are generated on deploy; assert to
// avoid local type drift (same pattern as lib/sales-targets.ts).
const biDb = prisma as unknown as { businessSession: { findUnique: (args: unknown) => Promise<{
  officialCollection: number; cancellations: number; discounts: number; signedBillsTotal: number; dailyLoss: number
} | null> } }

/**
 * GET — the Service Staff Dashboard for the caller's own outlet/day: whichever
 * of BEFORE (working) or AFTER (validated, read-only) mode applies, plus
 * their Sales Target Performance. Every user sees only their own data — no
 * staffId param, always derived from the JWT.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.outletId) return NextResponse.json({ error: 'No outlet assigned' }, { status: 400 })

  const dateParam = new URL(req.url).searchParams.get('date')
  const parsed = dateParam ? parse(dateParam, 'yyyy-MM-dd', new Date()) : new Date()
  const date = startOfDay(isValid(parsed) ? parsed : new Date())
  const outletId = user.outletId

  const [session, collection, outlet] = await Promise.all([
    prisma.transactionSession.findUnique({ where: { outletId_date: { outletId, date } } }),
    prisma.dailyCollection.findFirst({
      where: { outletId, date, staffName: user.name },
      include: { channels: true, cancellations: true },
    }),
    prisma.outlet.findUnique({ where: { id: outletId }, select: { name: true } }),
  ])

  const base = { date: date.toISOString(), outletName: outlet?.name || '' }

  if (!collection) {
    // BEFORE VALIDATION — working mode. No session yet at all is its own
    // empty state (cashier hasn't imported System Sales); an open session
    // with nothing declared yet is a normal starting point, not an error.
    if (!session) return NextResponse.json({ ...base, mode: 'NO_SESSION' })

    const [transactions, systemSalesRow] = await Promise.all([
      prisma.staffTransaction.findMany({ where: { sessionId: session.id, staffId: user.userId }, orderBy: { createdAt: 'desc' } }),
      prisma.systemSalesRecord.findFirst({ where: { sessionId: session.id, staffName: user.name } }),
    ])
    const summary = summarizeStaffTransactions(transactions)
    const systemSales = systemSalesRow?.amount || 0
    const difference = staffDifference(systemSales, summary)
    const { bank, mobileMoney } = splitChannelTotals(summary.channelTotals)

    const blockers: string[] = []
    if (summary.pendingApprovals > 0) blockers.push(`${summary.pendingApprovals} transaction(s) awaiting manager approval`)
    if (transactions.length === 0) blockers.push('No transactions declared yet')

    return NextResponse.json({
      ...base,
      mode: 'BEFORE',
      sessionStatus: session.status,
      systemSales, declaredTotal: summary.grandTotal, difference,
      cash: summary.cash, bank, mobileMoney, channelTotals: summary.channelTotals,
      signedBills: summary.signedBills, discounts: summary.discounts, cancellations: summary.cancellations,
      pendingApprovals: summary.pendingApprovals,
      transactions,
      readiness: { ready: blockers.length === 0, blockers },
    })
  }

  // AFTER VALIDATION — read-only performance mode.
  const channelTotals: Record<string, number> = {}
  for (const c of collection.channels) channelTotals[c.channelCode] = c.amount
  if (collection.crdb && !channelTotals.CRDB) channelTotals.CRDB = collection.crdb
  if (collection.stanbic && !channelTotals.STANBIC) channelTotals.STANBIC = collection.stanbic
  if (collection.mpesa && !channelTotals.MPESA) channelTotals.MPESA = collection.mpesa
  const { bank, mobileMoney } = splitChannelTotals(channelTotals)

  const [signedBills, staffLossBills] = await Promise.all([
    prisma.signedBill.findMany({ where: { serviceStaff: user.name, date, outletId, billType: { not: 'STAFF_LOSS' } } }),
    prisma.signedBill.findMany({ where: { serviceStaff: user.name, outletId, billType: 'STAFF_LOSS' } }),
  ])
  const signedBillIds = signedBills.map((b) => b.id)
  const staffLossBillIds = staffLossBills.map((b) => b.id)
  const [signedPaid, staffLossPaidToday, sessionTxns, paidBillsForStaff] = await Promise.all([
    signedBillIds.length ? prisma.paidBill.groupBy({ by: ['signedBillId'], where: { signedBillId: { in: signedBillIds } }, _sum: { amountPaid: true } }) : Promise.resolve([]),
    staffLossBillIds.length ? prisma.paidBill.aggregate({ where: { signedBillId: { in: staffLossBillIds }, date: { gte: date, lte: endOfDay(date) } }, _sum: { amountPaid: true } }) : Promise.resolve({ _sum: { amountPaid: 0 } }),
    session ? prisma.staffTransaction.findMany({ where: { sessionId: session.id, staffId: user.userId } }) : Promise.resolve([]),
    session
      ? prisma.staffTransaction.findMany({ where: { sessionId: session.id, staffId: user.userId, category: 'SIGNED_BILL' } })
        .then((txns) => txns.length ? prisma.paidBill.findMany({ where: { billRef: { in: txns.map((t) => `TXN-${t.id}`) } } }) : [])
      : Promise.resolve([]),
  ])
  const paidBySignedBill = new Map(signedPaid.map((p) => [p.signedBillId, p._sum.amountPaid || 0]))
  const staffLossPaidAllTime = await (staffLossBillIds.length
    ? prisma.paidBill.aggregate({ where: { signedBillId: { in: staffLossBillIds } }, _sum: { amountPaid: true } })
    : Promise.resolve({ _sum: { amountPaid: 0 } }))

  const countByStatus = (category: string) => {
    const rows = sessionTxns.filter((t) => t.category === category)
    return {
      count: rows.length,
      amount: roundMoney(rows.reduce((s, t) => s + t.amount, 0)),
      approved: rows.filter((t) => t.status === 'APPROVED').length,
      pending: rows.filter((t) => t.status === 'PENDING_APPROVAL').length,
      rejected: rows.filter((t) => t.status === 'REJECTED').length,
      records: rows,
    }
  }

  const signedBillsPaidCount = signedBills.filter((b) => b.status === 'PAID').length
  const signedBillsPaidAmount = roundMoney(signedBills.reduce((s, b) => s + (paidBySignedBill.get(b.id) || 0), 0))
  const signedBillsOutstanding = roundMoney(signedBills.reduce((s, b) => s + (b.amount - (paidBySignedBill.get(b.id) || 0)), 0))

  const dailyLossVariance = roundMoney(collection.systemSales - collection.total - collection.creditSales - collection.paymentsReceived - collection.discount)
  const outstandingLossBalance = roundMoney(staffLossBills.reduce((s, b) => s + b.amount, 0) - (staffLossPaidAllTime._sum.amountPaid || 0))

  const targetPayload = await computeStaffTarget(outletId, user.name, date)
  const insights = await computeAfterModeInsights({ outletId, staffName: user.name, date, session, staffId: user.userId, collectionTotal: collection.total, targetPayload })

  return NextResponse.json({
    ...base,
    mode: 'AFTER',
    collection: {
      expectedSales: collection.systemSales, official: collection.total, difference: roundMoney(collection.systemSales - collection.total),
      cash: collection.cash, bank, mobileMoney, grandTotal: collection.total,
    },
    signedBillsAfter: {
      issuedCount: signedBills.length, issuedAmount: roundMoney(signedBills.reduce((s, b) => s + b.amount, 0)),
      approvedCount: signedBills.length, pendingCount: 0, rejectedCount: countByStatus('CREDIT_SALE').rejected,
      paidCount: signedBillsPaidCount, paidAmount: signedBillsPaidAmount, outstandingAmount: signedBillsOutstanding,
      records: signedBills,
    },
    discountsAfter: countByStatus('DISCOUNT'),
    cancellationsAfter: { ...countByStatus('CANCELLATION'), approvedRecords: collection.cancellations },
    paidBills: {
      billsCollectedCount: paidBillsForStaff.length, billsPaidAmount: roundMoney(paidBillsForStaff.reduce((s, p) => s + p.amountPaid, 0)),
      outstandingAmount: signedBillsOutstanding, staffLossRecoveryAmount: roundMoney(staffLossPaidAllTime._sum.amountPaid || 0),
      records: paidBillsForStaff,
    },
    dailyLoss: {
      expectedSales: collection.systemSales, official: collection.total, variance: dailyLossVariance,
      lossPaidToday: roundMoney(staffLossPaidToday._sum.amountPaid || 0), outstandingLossBalance,
    },
    target: targetPayload,
    insights,
  })
}

interface TargetRow { department: string; actual: number; weeklyTarget: number }

/**
 * BI-layer insights for the AFTER (validated) view — additive to the existing
 * response, computed from the standardized BusinessSession row rather than
 * re-deriving DoD/loss-cause figures inline. Returns null fields (not thrown
 * errors) when a prior day's BusinessSession doesn't exist yet, e.g. the
 * staff's first day, or before the backfill script has run.
 */
async function computeAfterModeInsights({ outletId, staffName, date, session, staffId, collectionTotal, targetPayload }: {
  outletId: string; staffName: string; date: Date
  session: { id: string } | null; staffId: string; collectionTotal: number
  targetPayload: TargetRow[]
}) {
  const [bsToday, bsYesterday] = await Promise.all([
    biDb.businessSession.findUnique({ where: { outletId_date_staffName: { outletId, date, staffName } } }),
    biDb.businessSession.findUnique({ where: { outletId_date_staffName: { outletId, date: startOfDay(subDays(date, 1)), staffName } } }),
  ])

  const collectionInsight = bsYesterday ? compare(collectionTotal, bsYesterday.officialCollection, 'yesterday') : null
  const lossInsight = bsToday ? lossAttribution(bsToday) : null

  const collectionTargetRow = targetPayload.find((t) => t.department === 'Total Collection')
  const targetInsight = collectionTargetRow ? targetAchievement(collectionTargetRow.actual, collectionTargetRow.weeklyTarget) : null

  let peakHour = null
  if (session) {
    const hourly = await getHourlyBreakdown(session.id, staffId)
    peakHour = peakHourInsight(hourly.buckets)
  }

  return { collection: collectionInsight, loss: lossInsight, target: targetInsight, peakHour }
}

async function computeStaffTarget(outletId: string, staffName: string, date: Date) {
  const [targets, actuals] = await Promise.all([
    loadActiveTargets(),
    computeActuals({ from: date, to: endOfDay(date), outletId }),
  ])
  const staffActuals = (actuals.byStaff[outletId] || []).find((s) => s.staffName.trim().toLowerCase() === staffName.trim().toLowerCase())
  const perStaffTargets = targets.filter((t) => t.scope === 'Per Staff' && t.outletId === outletId)

  return perStaffTargets.map((t) => {
    const key = targetDeptKey(t.department)
    const actual = staffActuals ? staffActuals[key] : 0
    const { target } = targetLevels(t, 'weekly')
    const dailyTarget = roundMoney(t.weeklyTarget / 7)
    const achievementPct = dailyTarget > 0 ? Math.round((actual / dailyTarget) * 100) : 0
    const status = achievementPct >= 100 ? 'ABOVE_TARGET' : achievementPct >= 80 ? 'ON_TARGET' : 'BELOW_TARGET'
    return {
      department: t.department, unit: t.unit, unitLabel: t.unitLabel,
      dailyTarget, actual: roundMoney(actual), achievementPct, remaining: roundMoney(Math.max(0, dailyTarget - actual)),
      status, weeklyTarget: target,
    }
  })
}
