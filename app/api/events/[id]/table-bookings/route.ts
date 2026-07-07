import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'
import { createTableBooking } from '@/lib/bookings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED']

/** POST /api/events/[id]/table-bookings — manager-entered walk-in/phone reservation. body: { tableId, name, phone, guests?, depositPaid?, specialRequests? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.tableId) return NextResponse.json({ error: 'tableId is required' }, { status: 400 })
  if (!body.name?.trim() || !body.phone?.trim()) return NextResponse.json({ error: 'Name and phone are required' }, { status: 400 })

  try {
    const booking = await prisma.$transaction((tx) => createTableBooking(tx, {
      eventId: id, tableId: body.tableId, name: body.name, phone: body.phone, guests: Number(body.guests) || 1,
      depositPaid: Number(body.depositPaid) || 0, specialRequests: body.specialRequests,
    }))
    return NextResponse.json(booking, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'TABLE_NOT_FOUND') return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    if (msg === 'TABLE_UNAVAILABLE') return NextResponse.json({ error: 'That table is no longer available' }, { status: 409 })
    throw err
  }
}

/** PATCH /api/events/[id]/table-bookings — update a booking. body: { bookingId, depositPaid?, bookingStatus? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const body = await req.json().catch(() => ({}))
  if (!body.bookingId) return NextResponse.json({ error: 'bookingId is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.depositPaid !== undefined) data.depositPaid = roundMoney(Number(body.depositPaid) || 0)
  if (body.bookingStatus !== undefined) {
    if (!BOOKING_STATUSES.includes(body.bookingStatus)) return NextResponse.json({ error: 'Invalid booking status' }, { status: 400 })
    data.bookingStatus = body.bookingStatus
  }

  const item = await db.tableBooking.update({ where: { id: body.bookingId }, data })
  return NextResponse.json(item)
}

/** DELETE /api/events/[id]/table-bookings?bookingId= — cancel a table booking and free the table. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const bookingId = new URL(req.url).searchParams.get('bookingId')
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 })

  const existing = await db.tableBooking.findUnique({ where: { id: bookingId } })
  if (!existing) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tdb = tx as any
    await tdb.tableBooking.update({ where: { id: bookingId }, data: { bookingStatus: 'CANCELLED' } })
    await tdb.eventTable.update({ where: { id: existing.tableId }, data: { status: 'AVAILABLE' } })
  })

  return NextResponse.json({ ok: true })
}
