import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { settlePosOrder, canActOnOrder, ORDER_MANAGEMENT_ROLES } from '@/lib/pos-close'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: orderId } = await params
  const body = await req.json()
  const { paymentMethod, paidAmount } = body
  if (!paymentMethod) return NextResponse.json({ error: 'paymentMethod required' }, { status: 400 })

  const order = await prisma.posOrder.findUnique({ where: { id: orderId } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!canActOnOrder(payload, order)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (order.status === 'CLOSED') return NextResponse.json({ error: 'Already closed' }, { status: 400 })

  // Don't let items get orphaned mid-queue — a manager override can still force
  // this via a dedicated flag if a genuinely stuck item needs writing off.
  const outstanding = await prisma.posOrderItem.count({ where: { orderId, status: { in: ['PENDING', 'SENT'] } } })
  if (outstanding > 0 && !(body.force && ORDER_MANAGEMENT_ROLES.includes(payload.role))) {
    return NextResponse.json({ error: `${outstanding} item(s) are still pending/queued at the counter — send or clear them before closing.` }, { status: 409 })
  }

  const finalAmount = roundMoney(order.totalAmount - order.discount)
  const paid = roundMoney(paidAmount ?? finalAmount)

  await settlePosOrder({ orderId, paymentMethod, paidAmount: paid, userId: payload.userId })

  return NextResponse.json({ ok: true, orderNo: order.orderNo, total: finalAmount, paymentMethod })
}
