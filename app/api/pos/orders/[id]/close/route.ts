import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: orderId } = await params
  const { paymentMethod, paidAmount } = await req.json()
  if (!paymentMethod) return NextResponse.json({ error: 'paymentMethod required' }, { status: 400 })

  const order = await prisma.posOrder.findUnique({ where: { id: orderId } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status === 'CLOSED') return NextResponse.json({ error: 'Already closed' }, { status: 400 })

  const now = new Date()
  const finalAmount = roundMoney(order.totalAmount - order.discount)
  const paid = roundMoney(paidAmount ?? finalAmount)

  await prisma.posOrder.update({
    where: { id: orderId },
    data: { status: 'CLOSED', paymentMethod, paidAmount: paid, closedAt: now, closedBy: payload.userId },
  })

  // Feed into DailyCollection.systemSales for today's entry at this outlet
  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)

  const existing = await prisma.dailyCollection.findFirst({
    where: { outletId: order.outletId, date: { gte: todayStart } },
    orderBy: { date: 'desc' },
  })

  if (existing) {
    await prisma.dailyCollection.update({
      where: { id: existing.id },
      data: { systemSales: roundMoney(existing.systemSales + finalAmount) },
    })
  }

  return NextResponse.json({ ok: true, orderNo: order.orderNo, total: finalAmount, paymentMethod })
}
