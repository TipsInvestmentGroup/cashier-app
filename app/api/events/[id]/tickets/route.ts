import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, EXPENSE_PAYMENT_STATUSES } from '@/lib/scheduling'
import { createTicketBooking } from '@/lib/bookings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CANCELLED']

/** POST /api/events/[id]/tickets — manager-entered walk-in/phone booking. body: { ticketTypeId, fullName, phone, email?, quantity? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.ticketTypeId) return NextResponse.json({ error: 'ticketTypeId is required' }, { status: 400 })
  if (!body.fullName?.trim() || !body.phone?.trim()) return NextResponse.json({ error: 'Full name and phone are required' }, { status: 400 })

  try {
    const booking = await prisma.$transaction((tx) => createTicketBooking(tx, {
      eventId: id, ticketTypeId: body.ticketTypeId, fullName: body.fullName, phone: body.phone, email: body.email, quantity: Number(body.quantity) || 1,
    }))
    return NextResponse.json(booking, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'TICKET_TYPE_NOT_FOUND') return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 })
    if (msg === 'SOLD_OUT') return NextResponse.json({ error: 'Not enough tickets remaining for this type' }, { status: 409 })
    throw err
  }
}

/** PATCH /api/events/[id]/tickets — update a booking. body: { bookingId, paymentStatus?, bookingStatus?, checkedIn? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const body = await req.json().catch(() => ({}))
  if (!body.bookingId) return NextResponse.json({ error: 'bookingId is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.paymentStatus !== undefined) {
    if (!EXPENSE_PAYMENT_STATUSES.includes(body.paymentStatus)) return NextResponse.json({ error: 'Invalid payment status' }, { status: 400 })
    data.paymentStatus = body.paymentStatus
  }
  if (body.bookingStatus !== undefined) {
    if (!BOOKING_STATUSES.includes(body.bookingStatus)) return NextResponse.json({ error: 'Invalid booking status' }, { status: 400 })
    data.bookingStatus = body.bookingStatus
  }
  if (body.checkedIn !== undefined) {
    data.checkedIn = !!body.checkedIn
    data.checkedInAt = data.checkedIn ? new Date() : null
  }

  const item = await db.ticketBooking.update({ where: { id: body.bookingId }, data })
  return NextResponse.json(item)
}

/** DELETE /api/events/[id]/tickets?bookingId= — cancel a ticket booking. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const bookingId = new URL(req.url).searchParams.get('bookingId')
  if (!bookingId) return NextResponse.json({ error: 'bookingId required' }, { status: 400 })
  await db.ticketBooking.update({ where: { id: bookingId }, data: { bookingStatus: 'CANCELLED' } })
  return NextResponse.json({ ok: true })
}
