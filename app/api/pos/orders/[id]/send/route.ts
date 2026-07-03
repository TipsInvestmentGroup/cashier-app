import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: orderId } = await params

  const order = await prisma.posOrder.findUnique({ where: { id: orderId } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status === 'CLOSED' || order.status === 'CANCELLED')
    return NextResponse.json({ error: 'Order is closed' }, { status: 400 })

  const pendingItems = await prisma.posOrderItem.findMany({
    where: { orderId, status: 'PENDING' },
  })
  if (pendingItems.length === 0)
    return NextResponse.json({ error: 'No pending items to send' }, { status: 400 })

  // Group by counterCode for separate print logs
  const byCounter: Record<string, typeof pendingItems> = {}
  for (const item of pendingItems) {
    const code = item.counterCode ?? 'MAIN'
    if (!byCounter[code]) byCounter[code] = []
    byCounter[code].push(item)
  }

  const now = new Date()

  // Counter service models: items sent to a DIRECT counter (Main Bar model —
  // the seller serves immediately) skip the prep queue and are PREPARED at
  // once; PREP counters (VIP/kitchen model) queue as SENT until staff mark
  // them ready.
  const counters = await prisma.posCounter.findMany({ where: { outletId: order.outletId } })
  const modelOf = (code: string) =>
    (counters.find((c) => c.code === code) as { serviceModel?: string } | undefined)?.serviceModel ?? 'PREP'

  for (const [counterCode, items] of Object.entries(byCounter)) {
    const direct = modelOf(counterCode) === 'DIRECT'
    await prisma.posOrderItem.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: direct
        ? { status: 'PREPARED', sentAt: now, preparedAt: now, preparedBy: payload.userId }
        : { status: 'SENT', sentAt: now },
    })
  }

  for (const [counterCode, items] of Object.entries(byCounter)) {
    await prisma.posPrintLog.create({
      data: {
        orderId,
        counterCode,
        printedBy: payload.userId,
        items: JSON.stringify(
          items.map((i: { productName: string; quantity: number; extras: string | null }) => ({
            name: i.productName,
            qty: i.quantity,
            extras: i.extras,
          }))
        ),
      },
    })
  }

  // Still-queued items → SENT; everything already prepared (all-DIRECT order,
  // e.g. Main Bar) → READY straight away.
  const outstanding = await prisma.posOrderItem.count({
    where: { orderId, status: { in: ['PENDING', 'SENT'] } },
  })
  await prisma.posOrder.update({ where: { id: orderId }, data: { status: outstanding > 0 ? 'SENT' : 'READY' } })

  return NextResponse.json({ ok: true, sent: pendingItems.length, counters: Object.keys(byCounter) })
}
