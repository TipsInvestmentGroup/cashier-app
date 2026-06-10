import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId') || user.outletId

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
      where: { ...outletFilter, status: { not: 'PAID' } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.signedBill.groupBy({
      by: ['personName'],
      where: { ...outletFilter, status: { not: 'PAID' }, billType: { in: ['CUSTOMER', 'ADMIN', 'DIRECTOR'] } },
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

  const outletPerformance = outletStats.map((o) => ({
    name: o.name,
    total: o.dailyCollections.reduce((sum, c) => sum + c.total, 0),
  }))

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
