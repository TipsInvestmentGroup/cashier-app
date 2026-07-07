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

  const { tableId, shiftId, outletId: bodyOutletId, eventId, clientRequestId } = await req.json()
  if (!shiftId) return NextResponse.json({ error: 'shiftId required' }, { status: 400 })

  const outletId = payload.outletId ?? bodyOutletId
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  // Offline-queue retry: if this exact create was already applied (e.g. the
  // first attempt succeeded server-side but its response never reached the
  // client before the connection dropped again), return the same order
  // instead of creating a duplicate for the same table. The client compares
  // the returned clientRequestId against its own to tell "this is genuinely
  // my order" apart from the tableId short-circuit below returning someone
  // ELSE's pre-existing order for that table.
  if (clientRequestId) {
    const existingByKey = await prisma.posOrder.findUnique({ where: { clientRequestId } })
    if (existingByKey) return NextResponse.json(existingByKey)
  }

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
        data: { orderNo, outletId, tableId: tableId ?? null, eventId: eventId ?? null, shiftId, waiterId: payload.userId, clientRequestId: clientRequestId ?? null },
      })
      break
    } catch (err) {
      // A clientRequestId collision means a concurrent request already
      // created this exact order (the pre-check above missed it in a tight
      // race) — return that row instead of retrying with a new orderNo,
      // which would never succeed since clientRequestId stays fixed.
      if (clientRequestId && err instanceof Error && err.message.includes('clientRequestId')) {
        const existingByKey = await prisma.posOrder.findUnique({ where: { clientRequestId } })
        if (existingByKey) { order = existingByKey; break }
      }
      if (err instanceof Error && err.message.includes('Unique') && attempt < 4) continue
      throw err
    }
  }
  return NextResponse.json(order, { status: 201 })
}
