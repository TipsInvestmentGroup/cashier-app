import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { settlePosOrder } from '@/lib/pos-close'

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

  const finalAmount = roundMoney(order.totalAmount - order.discount)
  const paid = roundMoney(paidAmount ?? finalAmount)

  await settlePosOrder({ orderId, paymentMethod, paidAmount: paid, userId: payload.userId })

  return NextResponse.json({ ok: true, orderNo: order.orderNo, total: finalAmount, paymentMethod })
}
