import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { settlePosOrder } from '@/lib/pos-close'

type Params = { params: Promise<{ id: string }> }

const METHODS = ['CASH', 'CRDB', 'STANBIC', 'MPESA']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * POST /api/pos/orders/[id]/pay — record a (possibly partial) payment.
 * body: { amount, method, note? }
 * Recording staff are the verifiers (they confirm the cash/digital receipt).
 * When the running total settles the bill, the order closes automatically and
 * feeds DailyCollection; otherwise it stays open with a balance.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: orderId } = await params
  const body = await req.json().catch(() => ({}))
  const amount = roundMoney(Number(body.amount) || 0)
  const method: string = body.method

  if (!(amount > 0)) return NextResponse.json({ error: 'Weka kiasi sahihi' }, { status: 400 })
  if (!METHODS.includes(method)) return NextResponse.json({ error: 'Njia ya malipo si sahihi' }, { status: 400 })

  const order = await prisma.posOrder.findUnique({ where: { id: orderId } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status === 'CLOSED' || order.status === 'CANCELLED')
    return NextResponse.json({ error: 'Order is closed' }, { status: 400 })

  const net = roundMoney(order.totalAmount - order.discount)
  const balance = roundMoney(net - order.paidAmount)
  if (amount > balance + 0.5)
    return NextResponse.json({ error: `Kiasi kinazidi baki (${balance.toLocaleString()})` }, { status: 400 })

  const payment = await db.posPayment.create({
    data: {
      orderId, amount, method,
      receivedById: payload.userId, receivedByName: payload.name,
      note: body.note || null,
    },
  })

  const newPaid = roundMoney(order.paidAmount + amount)
  const settled = newPaid >= net - 0.5

  if (settled) {
    // Mixed methods across partial payments → record MIXED on the order.
    const all = await db.posPayment.findMany({ where: { orderId }, select: { method: true } })
    const methods = new Set(all.map((p: { method: string }) => p.method))
    await settlePosOrder({ orderId, paymentMethod: methods.size > 1 ? 'MIXED' : method, paidAmount: newPaid, userId: payload.userId })
  } else {
    await prisma.posOrder.update({ where: { id: orderId }, data: { paidAmount: newPaid } })
  }

  return NextResponse.json({ ok: true, payment, paidAmount: newPaid, balance: roundMoney(net - newPaid), settled }, { status: 201 })
}
