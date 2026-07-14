import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { settlePosOrder, canActOnOrder } from '@/lib/pos-close'

type Params = { params: Promise<{ id: string }> }

// Same bootstrap defaults /api/payment-channels seeds on first read — covers
// the edge case where nobody has opened that page yet on a fresh install.
const DEFAULT_METHODS = ['CASH', 'CRDB', 'STANBIC', 'MPESA']

async function isValidMethod(method: string): Promise<boolean> {
  const count = await prisma.paymentChannel.count()
  if (count === 0) return DEFAULT_METHODS.includes(method)
  return !!(await prisma.paymentChannel.findFirst({ where: { code: method, isActive: true } }))
}

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
  if (!(await isValidMethod(method))) return NextResponse.json({ error: 'Njia ya malipo si sahihi' }, { status: 400 })

  const orderForAuth = await prisma.posOrder.findUnique({ where: { id: orderId }, select: { outletId: true } })
  if (!orderForAuth) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!canActOnOrder(payload, orderForAuth)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Everything below runs in one transaction, re-reading paidAmount fresh
    // inside it — SQLite serializes concurrent transactions, so two
    // simultaneous partial payments can no longer both read a stale balance
    // and both think they're settling the order (previously a real race).
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.posOrder.findUnique({ where: { id: orderId } })
      if (!order) throw new Error('NOT_FOUND')
      if (order.status === 'CLOSED' || order.status === 'CANCELLED') throw new Error('ALREADY_CLOSED')

      const net = roundMoney(order.totalAmount - order.discount)
      const balance = roundMoney(net - order.paidAmount)
      if (amount > balance + 0.5) throw new Error(`OVER_BALANCE:${balance}`)

      const payment = await tx.posPayment.create({
        data: { orderId, amount, method, receivedById: payload.userId, receivedByName: payload.name, note: body.note || null },
      })

      const newPaid = roundMoney(order.paidAmount + amount)
      const settled = newPaid >= net - 0.5

      if (settled) {
        const all = await tx.posPayment.findMany({ where: { orderId }, select: { method: true } })
        const methods = new Set(all.map((p: { method: string }) => p.method))
        await settlePosOrder({ orderId, paymentMethod: methods.size > 1 ? 'MIXED' : method, paidAmount: newPaid, userId: payload.userId }, tx)
      } else {
        await tx.posOrder.update({ where: { id: orderId }, data: { paidAmount: newPaid } })
      }

      return { payment, paidAmount: newPaid, balance: roundMoney(net - newPaid), settled }
    })

    return NextResponse.json({ ok: true, ...result }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'NOT_FOUND') return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if (msg === 'ALREADY_CLOSED') return NextResponse.json({ error: 'Order is closed' }, { status: 400 })
    if (msg.startsWith('OVER_BALANCE:')) return NextResponse.json({ error: `Kiasi kinazidi baki (${Number(msg.split(':')[1]).toLocaleString()})` }, { status: 400 })
    throw err
  }
}
