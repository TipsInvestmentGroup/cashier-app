import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
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
      where: { ...outletFilter, status: { not: 'PAID' }, OR: [{ approvalStatus: 'APPROVED' }, { billType: { notIn: ['CUSTOMER', 'TIPS', 'DJ'] } }] },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.signedBill.groupBy({
      by: ['personName'],
      where: { ...outletFilter, status: { not: 'PAID' }, OR: [{ approvalStatus: 'APPROVED' }, { billType: { notIn: ['CUSTOMER', 'TIPS', 'DJ'] } }], billType: { in: ['CUSTOMER', 'ADMIN', 'DIRECTOR'] } },
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

  // Per-outlet metrics for the dashboard outlet-performance widget
  const [todayByOutlet, unpaidByOutlet] = await Promise.all([
    prisma.dailyCollection.groupBy({
      by: ['outletId'],
      where: { date: { gte: todayStart, lte: todayEnd } },
      _sum: { total: true, systemSales: true, creditSales: true, paymentsReceived: true },
    }),
    prisma.signedBill.groupBy({
      by: ['outletId'],
      where: { status: { not: 'PAID' }, OR: [{ approvalStatus: 'APPROVED' }, { billType: { notIn: ['CUSTOMER', 'TIPS', 'DJ'] } }] },
      _sum: { amount: true },
    }),
  ])

  // Outstanding signed bills grouped by category (Admin/Director/Customer/Tips/DJ/Staff Loss)
  const byTypeRaw = await prisma.signedBill.groupBy({
    by: ['billType'],
    where: { ...outletFilter, status: { not: 'PAID' }, OR: [{ approvalStatus: 'APPROVED' }, { billType: { notIn: ['CUSTOMER', 'TIPS', 'DJ'] } }] },
    _sum: { amount: true },
  })
  const byBillType: Record<string, number> = {}
  for (const r of byTypeRaw) byBillType[r.billType] = r._sum.amount || 0

  const outletPerformance = outletStats.map((o) => {
    const t = todayByOutlet.find((x) => x.outletId === o.id)
    const todayTotal = t?._sum.total || 0
    const todaySystem = t?._sum.systemSales || 0
    const credit = t?._sum.creditSales || 0
    const paid = t?._sum.paymentsReceived || 0
    const u = unpaidByOutlet.find((x) => x.outletId === o.id)
    return {
      name: o.name,
      total: o.dailyCollections.reduce((sum, c) => sum + c.total, 0), // month (kept for compat)
      todayTotal,
      todaySystem,
      todayLoss: Math.max(0, todaySystem - todayTotal - credit - paid),
      outstanding: u?._sum.amount || 0,
    }
  })

  return NextResponse.json({
    today: {
      total: todayCollections._sum.total || 0,
      cash: todayCollections._sum.cash || 0,
      crdb: todayCollections._sum.crdb || 0,
      stanbic: todayCollections._sum.stanbic || 0,
      mpesa: todayCollections._sum.mpesa || 0,
    },
    week: { total: weekCollections._sum.total || 0 },
    month: { total: monthCollections._sum.total || 0 },
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
  })
}
