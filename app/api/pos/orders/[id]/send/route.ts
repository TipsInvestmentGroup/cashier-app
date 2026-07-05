import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canActOnOrder } from '@/lib/pos-close'
import { sendPushToUser } from '@/lib/push'
import { SUPPLIER_POSITION, MANAGEMENT_ROLES } from '@/lib/shared-constants'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: orderId } = await params

  const order = await prisma.posOrder.findUnique({ where: { id: orderId } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!canActOnOrder(payload, order)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
  // them ready. But "DIRECT" only means instant-serve when the person
  // sending IS that counter's own staff (self-serve, e.g. a Bar Lady making
  // an order for her own seated customer) — some outlets (Coco Beach) also
  // route Outside Staff orders through a DIRECT counter for the counter
  // staff to prepare and hand over for delivery, which still needs a real
  // queue entry so the counter staff can see and mark it ready.
  const counters = await prisma.posCounter.findMany({ where: { outletId: order.outletId } })
  const modelOf = (code: string) =>
    (counters.find((c) => c.code === code) as { serviceModel?: string } | undefined)?.serviceModel ?? 'PREP'
  const isSelfServe = (code: string) => {
    const ownerPosition = SUPPLIER_POSITION[code]
    return !ownerPosition || payload.position === ownerPosition || MANAGEMENT_ROLES.includes(payload.role)
  }

  for (const [counterCode, items] of Object.entries(byCounter)) {
    const direct = modelOf(counterCode) === 'DIRECT' && isSelfServe(counterCode)
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
  const newStatus = outstanding > 0 ? 'SENT' : 'READY'
  await prisma.posOrder.update({ where: { id: orderId }, data: { status: newStatus } })

  // This path can also produce a fresh READY (an all-DIRECT send, or a send
  // that happens to clear the last outstanding item) — previously only
  // counter/route.ts's PATCH handler fired the "ready to collect" push, so a
  // READY reached via this route silently skipped the notification even
  // though the waiter's screen picks it up fine via polling.
  if (newStatus === 'READY' && order.status !== 'READY') {
    const orderWithTable = await prisma.posOrder.findUnique({ where: { id: orderId }, select: { table: { select: { number: true, label: true } } } })
    const tableLabel = orderWithTable?.table ? `Meza ${orderWithTable.table.number}${orderWithTable.table.label ? ` — ${orderWithTable.table.label}` : ''}` : order.orderNo
    sendPushToUser(order.waiterId, {
      title: '✅ Tayari kuchukua',
      body: `${tableLabel} — bidhaa zipo tayari kwenye counter`,
      url: `/pos/order/${orderId}`,
    }).then((result) => {
      if (result.failed.length > 0) console.error(`[push] order ${orderId} ready-alert (via send): ${result.sent}/${result.attempted} delivered`, result.failed)
    }).catch((err) => console.error('[push] sendPushToUser threw for order', orderId, err))
  }

  return NextResponse.json({ ok: true, sent: pendingItems.length, counters: Object.keys(byCounter) })
}
