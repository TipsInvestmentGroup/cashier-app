import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push'

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  const code = req.nextUrl.searchParams.get('code')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const items = await prisma.posOrderItem.findMany({
    where: {
      order: { outletId, status: { in: ['OPEN', 'SENT'] } },
      status: 'SENT',
      ...(code ? { counterCode: code } : {}),
    },
    include: {
      order: {
        select: {
          orderNo: true,
          table: { select: { number: true, label: true } },
          waiter: { select: { name: true } },
        },
      },
    },
    orderBy: { sentAt: 'asc' },
  })

  return NextResponse.json(items)
}

/**
 * PATCH /api/pos/counter — counter staff marks a sent item as prepared/served,
 * which clears it from the counter queue. body: { itemId }
 */
export async function PATCH(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { itemId } = await req.json().catch(() => ({}))
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })

  const item = await prisma.posOrderItem.findUnique({ where: { id: itemId } })
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  if (item.status !== 'SENT') return NextResponse.json({ error: 'Only sent items can be marked ready' }, { status: 400 })

  const updated = await prisma.posOrderItem.update({
    where: { id: itemId },
    data: { status: 'PREPARED', preparedAt: new Date(), preparedBy: payload.userId },
  })

  // If nothing on the order is still pending or queued, the whole order is
  // READY — this notifies the waiter (VIP model: collect from the counter).
  const outstanding = await prisma.posOrderItem.count({
    where: { orderId: item.orderId, status: { in: ['PENDING', 'SENT'] } },
  })
  if (outstanding === 0) {
    const { count } = await prisma.posOrder.updateMany({
      where: { id: item.orderId, status: 'SENT' },
      data: { status: 'READY' },
    })
    if (count > 0) {
      const order = await prisma.posOrder.findUnique({
        where: { id: item.orderId },
        select: { orderNo: true, waiterId: true, table: { select: { number: true, label: true } } },
      })
      if (order) {
        const tableLabel = order.table ? `Meza ${order.table.number}${order.table.label ? ` — ${order.table.label}` : ''}` : order.orderNo
        // Best-effort — never block the counter action on push delivery, but
        // log failures so they're visible in Vercel's function logs.
        sendPushToUser(order.waiterId, {
          title: '✅ Tayari kuchukua',
          body: `${tableLabel} — bidhaa zipo tayari kwenye counter`,
          url: `/pos/order/${item.orderId}`,
        }).catch((err) => console.error('[push] sendPushToUser threw for order', item.orderId, err))
      }
    }
  }

  return NextResponse.json(updated)
}
