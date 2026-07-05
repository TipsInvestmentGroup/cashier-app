import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const orders = await prisma.posOrder.findMany({
    where: { outletId, status: { in: ['OPEN', 'SENT', 'READY'] } },
    include: {
      table: { select: { number: true, label: true } },
      waiter: { select: { name: true } },
      items: {
        where: { status: { not: 'CANCELLED' } },
        select: { id: true, productName: true, quantity: true, amount: true, status: true, counterCode: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(orders)
}

export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { tableId, shiftId, outletId: bodyOutletId } = await req.json()
  if (!shiftId) return NextResponse.json({ error: 'shiftId required' }, { status: 400 })

  const outletId = payload.outletId ?? bodyOutletId
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  // If table already has an open order, return it
  if (tableId) {
    const existing = await prisma.posOrder.findFirst({
      where: { tableId, status: { in: ['OPEN', 'SENT', 'READY'] } },
    })
    if (existing) return NextResponse.json(existing)
  }

  // shiftId is a required FK on PosOrder with no validation before this point
  // — a stale/mismatched id (e.g. an old cached shift from before an outlet
  // reconfiguration) would otherwise throw an uncaught FK-constraint error
  // here, surfacing to the waiter as a bare 500 with no usable message.
  const shift = await prisma.posShift.findUnique({ where: { id: shiftId } })
  if (!shift || shift.outletId !== outletId || shift.closedAt) {
    return NextResponse.json({ error: 'Shift haipo au imefungwa — anza shift mpya kwenye Waiter App.' }, { status: 400 })
  }

  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const dayStart = new Date(today.toDateString())

  // orderNo is unique across ALL outlets (not per-outlet), but the sequence
  // number was counted per-outlet — the first order of the day at a second
  // outlet always landed on "001" too, colliding with an outlet that had
  // already claimed it (e.g. Mikocheni creates ORD-...-001 first, then Coco
  // Beach's first order of the day also computes "001" and crashes on the
  // unique constraint). Count across all outlets instead, and retry with an
  // incrementing offset to absorb any remaining race between concurrent taps.
  let order
  for (let attempt = 0; attempt < 5; attempt++) {
    const count = await prisma.posOrder.count({ where: { createdAt: { gte: dayStart } } })
    const orderNo = `ORD-${dateStr}-${String(count + 1 + attempt).padStart(3, '0')}`
    try {
      order = await prisma.posOrder.create({
        data: { orderNo, outletId, tableId: tableId ?? null, shiftId, waiterId: payload.userId },
      })
      break
    } catch (err) {
      if (err instanceof Error && err.message.includes('Unique') && attempt < 4) continue
      throw err
    }
  }
  return NextResponse.json(order, { status: 201 })
}
