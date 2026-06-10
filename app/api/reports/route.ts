import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from 'date-fns'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') || 'daily'
  const outletId = searchParams.get('outletId')
  const customStart = searchParams.get('startDate')
  const customEnd = searchParams.get('endDate')

  const now = new Date()
  let start: Date, end: Date

  if (customStart && customEnd) {
    start = startOfDay(new Date(customStart))
    end = endOfDay(new Date(customEnd))
  } else {
    switch (type) {
      case 'weekly': start = startOfWeek(now); end = endOfWeek(now); break
      case 'monthly': start = startOfMonth(now); end = endOfMonth(now); break
      case 'quarterly': start = startOfQuarter(now); end = endOfQuarter(now); break
      case 'annual': start = startOfYear(now); end = endOfYear(now); break
      default: start = startOfDay(now); end = endOfDay(now)
    }
  }

  const dateFilter = { gte: start, lte: end }
  const outletFilter = outletId ? { outletId } : {}

  const [collections, signedBills, paidBills] = await Promise.all([
    prisma.dailyCollection.findMany({
      where: { ...outletFilter, date: dateFilter },
      include: { outlet: true, cashier: { select: { name: true } } },
      orderBy: { date: 'desc' },
    }),
    prisma.signedBill.findMany({
      where: { ...outletFilter, date: dateFilter },
      include: { outlet: true, person: true },
      orderBy: { date: 'desc' },
    }),
    prisma.paidBill.findMany({
      where: { ...outletFilter, date: dateFilter },
      include: { outlet: true, signedBill: true },
      orderBy: { date: 'desc' },
    }),
  ])

  const totalCollected = collections.reduce((s, c) => s + c.total, 0)
  const totalSigned = signedBills.reduce((s, b) => s + b.amount, 0)
  const totalPaid = paidBills.reduce((s, p) => s + p.amountPaid, 0)

  const byBillType = signedBills.reduce((acc: Record<string, number>, b) => {
    acc[b.billType] = (acc[b.billType] || 0) + b.amount
    return acc
  }, {})

  const byPaymentMethod = paidBills.reduce((acc: Record<string, number>, p) => {
    acc[p.paymentMethod] = (acc[p.paymentMethod] || 0) + p.amountPaid
    return acc
  }, {})

  return NextResponse.json({
    period: { start, end, type },
    summary: { totalCollected, totalSigned, totalPaid },
    collections,
    signedBills,
    paidBills,
    byBillType,
    byPaymentMethod,
  })
}
