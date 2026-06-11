import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId
  else if (user.outletId && !['ADMIN', 'DIRECTOR', 'MANAGER', 'ACCOUNTANT'].includes(user.role)) {
    where.outletId = user.outletId
  }
  if (startDate && endDate) {
    where.date = { gte: new Date(startDate), lte: new Date(endDate) }
  }

  const payments = await prisma.paidBill.findMany({
    where,
    include: {
      outlet: true,
      cashier: { select: { name: true } },
      signedBill: true,
      person: true,
    },
    orderBy: { date: 'desc' },
    take: 200,
  })

  return NextResponse.json(payments)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { signedBillId, personId, payerName, payerCategory, amountPaid, paymentMethod, notes, outletId, date, billRef } = body

  const usedOutletId = outletId || user.outletId
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })

  const payment = await prisma.paidBill.create({
    data: {
      signedBillId: signedBillId || null,
      personId: personId || null,
      payerCategory: payerCategory || null,
      payerName,
      amountPaid: Number(amountPaid),
      paymentMethod,
      notes,
      billRef,
      outletId: usedOutletId,
      cashierId: user.userId,
      date: date ? new Date(date) : new Date(),
    },
  })

  if (signedBillId) {
    const signedBill = await prisma.signedBill.findUnique({ where: { id: signedBillId } })
    if (signedBill) {
      const allPayments = await prisma.paidBill.aggregate({
        where: { signedBillId },
        _sum: { amountPaid: true },
      })
      const totalPaid = allPayments._sum.amountPaid || 0
      const newStatus = totalPaid >= signedBill.amount ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID'
      await prisma.signedBill.update({
        where: { id: signedBillId },
        data: { status: newStatus },
      })
    }
  }

  return NextResponse.json(payment, { status: 201 })
}
