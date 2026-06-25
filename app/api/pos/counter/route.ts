import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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
  return NextResponse.json(updated)
}
