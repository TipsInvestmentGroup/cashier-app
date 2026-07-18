import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { approvalGate, TOP_DEBTOR_BILL_TYPES } from '@/lib/bill-types'
import { getCollectionSessionTotals } from '@/lib/collection-session-totals'
import { getSessionTotals, getSessionsByStaff, getSessionTotalsByOutlet } from '@/lib/bi/business-sessions'
import { compare, trendLabel } from '@/lib/bi/insights'
import { getPendingApprovalCounts } from '@/lib/bi/pending-approvals'
import { getUnreconciledBankCounts } from '@/lib/bi/bank-recon-status'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  // Cashiers are locked to their own outlet; managers/admin can pick any.
  const outletId = user.role === 'CASHIER' && user.outletId ? user.outletId : (searchParams.get('outletId') || user.outletId)

  const now = new Date()
  const todayStart = startOfDay(now)
  const todayEnd = endOfDay(now)
  const weekStart = startOfWeek(now)
  const weekEnd = endOfWeek(now)
  const monthStart = startOfMonth(now)
  const monthEnd = endOfMonth(now)
  const yesterday = subDays(now, 1)
  const yesterdayStart = startOfDay(yesterday)
  const yesterdayEnd = endOfDay(yesterday)
  const prevWeekStart = startOfWeek(subDays(weekStart, 1))
  const prevWeekEnd = endOfWeek(subDays(weekStart, 1))

  const outletFilter = outletId ? { outletId } : {}

  const [
    todayCollections,
    weekCollections,
    monthCollections,
    unpaidBills,
    topDebtors,
    outletStats,
    paymentMethodBreakdown,
    recentBills,
    dailyTrend,
  ] = await Promise.all([
    prisma.dailyCollection.aggregate({
      where: { ...outletFilter, date: { gte: todayStart, lte: todayEnd } },
      _sum: { total: true, cash: true, crdb: true, stanbic: true, mpesa: true },
    }),
    prisma.dailyCollection.aggregate({
      where: { ...outletFilter, date: { gte: weekStart, lte: weekEnd } },
      _sum: { total: true },
    }),
    prisma.dailyCollection.aggregate({
      where: { ...outletFilter, date: { gte: monthStart, lte: monthEnd } },
      _sum: { total: true },
    }),
    prisma.signedBill.aggregate({
      where: { ...outletFilter, status: { not: 'PAID' }, ...approvalGate() },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.signedBill.groupBy({
      by: ['personName'],
      where: { ...outletFilter, status: { not: 'PAID' }, ...approvalGate(), billType: { in: [...TOP_DEBTOR_BILL_TYPES] } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    }),
    prisma.outlet.findMany({
      include: {
        dailyCollections: {
          where: { date: { gte: monthStart, lte: monthEnd } },
          select: { total: true },
        },
      },
    }),
    prisma.paidBill.groupBy({
      by: ['paymentMethod'],
      where: { ...outletFilter, date: { gte: monthStart, lte: monthEnd } },
      _sum: { amountPaid: true },
    }),
    prisma.signedBill.findMany({
      where: outletFilter,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { outlet: true },
    }),
    prisma.dailyCollection.findMany({
      where: { ...outletFilter, date: { gte: subDays(now, 30), lte: now } },
      orderBy: { date: 'asc' },
      select: { date: true, total: true },
    }),
  ])

  const [templateToday, templateWeek, templateMonth] = await Promise.all([
    getCollectionSessionTotals({ outletId, dateRange: { gte: todayStart, lte: todayEnd } }),
    getCollectionSessionTotals({ outletId, dateRange: { gte: weekStart, lte: weekEnd } }),
    getCollectionSessionTotals({ outletId, dateRange: { gte: monthStart, lte: monthEnd } }),
  ])
  const sumTotals = (rows: { total: number }[]) => rows.reduce((s, r) => s + r.total, 0)

  // Per-outlet metrics for the dashboard outlet-performance widget
  const [todayByOutlet, unpaidByOutlet] = await Promise.all([
    prisma.dailyCollection.groupBy({
      by: ['outletId'],
      where: { date: { gte: todayStart, lte: todayEnd } },
      _sum: { total: true, systemSales: true, creditSales: true, paymentsReceived: true },
    }),
    prisma.signedBill.groupBy({
      by: ['outletId'],
      where: { status: { not: 'PAID' }, ...approvalGate() },
      _sum: { amount: true },
    }),
  ])

  // Outstanding signed bills grouped by category (Admin/Director/Customer/Tips/DJ/Staff Loss)
  const byTypeRaw = await prisma.signedBill.groupBy({
    by: ['billType'],
    where: { ...outletFilter, status: { not: 'PAID' }, ...approvalGate() },
    _sum: { amount: true },
  })
  const byBillType: Record<string, number> = {}
  for (const r of byTypeRaw) byBillType[r.billType] = r._sum.amount || 0

  // Canonical per-outlet "today loss" from the BI layer (lib/staff-loss.ts's
  // formula via BusinessSession — includes approved cancellations, unlike the
  // inline fallback below). Falls back to the old formula for outlets with
  // no BusinessSession rows yet (e.g. before the backfill script has run).
  const todayLossByOutlet = new Map(
    await Promise.all(outletStats.map(async (o): Promise<[string, number | null]> => {
      const t = await getSessionTotals({ outletId: o.id, dateRange: { gte: todayStart, lte: todayEnd } })
      return [o.id, t.count > 0 ? t.dailyLoss : null]
    })),
  )

  const outletPerformance = outletStats.map((o) => {
    const t = todayByOutlet.find((x) => x.outletId === o.id)
    const todayTotal = t?._sum.total || 0
    const todaySystem = t?._sum.systemSales || 0
    const credit = t?._sum.creditSales || 0
    const paid = t?._sum.paymentsReceived || 0
    const u = unpaidByOutlet.find((x) => x.outletId === o.id)
    const canonicalLoss = todayLossByOutlet.get(o.id)
    return {
      name: o.name,
      total: o.dailyCollections.reduce((sum, c) => sum + c.total, 0), // month (kept for compat)
      todayTotal,
      todaySystem,
      todayLoss: canonicalLoss != null ? Math.max(0, canonicalLoss) : Math.max(0, todaySystem - todayTotal - credit - paid),
      outstanding: u?._sum.amount || 0,
    }
  })

  // BI-layer insights — additive: comparisons/trend text alongside the
  // existing numeric fields above, none of which change.
  const [todayBi, yesterdayBi, weekBi, prevWeekBi] = await Promise.all([
    getSessionTotals({ outletId, dateRange: { gte: todayStart, lte: todayEnd } }),
    getSessionTotals({ outletId, dateRange: { gte: yesterdayStart, lte: yesterdayEnd } }),
    getSessionTotals({ outletId, dateRange: { gte: weekStart, lte: weekEnd } }),
    getSessionTotals({ outletId, dateRange: { gte: prevWeekStart, lte: prevWeekEnd } }),
  ])
  const insights = {
    today: todayBi.count > 0 && yesterdayBi.count > 0 ? compare(todayBi.officialCollection, yesterdayBi.officialCollection, 'yesterday') : null,
    week: weekBi.count > 0 && prevWeekBi.count > 0 ? compare(weekBi.officialCollection, prevWeekBi.officialCollection, 'last week') : null,
    trend: trendLabel(dailyTrend.map((r) => r.total)),
  }

  // Role-specific decision-support widgets (Manager/HR/Finance/Executive) —
  // additive, gated by role in app/dashboard/widgets.ts, not computed here.
  const [staffTotals30d, pendingApprovals, unreconciledBank, growthThisWeek, growthPrevWeek] = await Promise.all([
    getSessionsByStaff({ outletId, dateRange: { gte: subDays(now, 29), lte: todayEnd } }),
    getPendingApprovalCounts({ outletId }),
    getUnreconciledBankCounts({ outletId, dateRange: { gte: monthStart, lte: monthEnd } }),
    getSessionTotalsByOutlet({ dateRange: { gte: weekStart, lte: weekEnd } }),
    getSessionTotalsByOutlet({ dateRange: { gte: prevWeekStart, lte: prevWeekEnd } }),
  ])
  const staffPerformance = [...staffTotals30d].sort((a, b) => a.dailyLoss - b.dailyLoss)
  const outletGrowth = outletStats
    .map((o) => {
      const cur = growthThisWeek.find((x) => x.outletId === o.id)?.officialCollection || 0
      const prev = growthPrevWeek.find((x) => x.outletId === o.id)?.officialCollection || 0
      const cmp = compare(cur, prev, 'last week')
      return { outletId: o.id, outletName: o.name, thisWeek: cur, prevWeek: prev, growthPct: cmp.pctChange, direction: cmp.direction }
    })
    .filter((o) => o.thisWeek > 0 || o.prevWeek > 0)
    .sort((a, b) => b.growthPct - a.growthPct)

  return NextResponse.json({
    today: {
      total: (todayCollections._sum.total || 0) + sumTotals(templateToday),
      cash: todayCollections._sum.cash || 0,
      crdb: todayCollections._sum.crdb || 0,
      stanbic: todayCollections._sum.stanbic || 0,
      mpesa: todayCollections._sum.mpesa || 0,
      templateCollections: sumTotals(templateToday),
    },
    week: { total: (weekCollections._sum.total || 0) + sumTotals(templateWeek) },
    month: { total: (monthCollections._sum.total || 0) + sumTotals(templateMonth) },
    byBillType,
    unpaidBills: {
      total: unpaidBills._sum.amount || 0,
      count: unpaidBills._count,
    },
    topDebtors,
    outletPerformance,
    paymentMethodBreakdown,
    recentBills,
    dailyTrend,
    insights,
    staffPerformance,
    pendingApprovals,
    unreconciledBank,
    outletGrowth,
  })
}
