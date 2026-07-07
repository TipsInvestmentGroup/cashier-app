import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { createTicketBooking } from '@/lib/bookings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any
const BOOKABLE_STATUSES = ['PLANNED', 'CONFIRMED']

/** POST /api/public/events/[id]/tickets — no auth. body: { ticketTypeId, fullName, phone, email?, quantity? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event || !BOOKABLE_STATUSES.includes(event.status)) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.ticketTypeId) return NextResponse.json({ error: 'ticketTypeId is required' }, { status: 400 })
  if (!body.fullName?.trim() || !body.phone?.trim()) return NextResponse.json({ error: 'Full name and phone are required' }, { status: 400 })

  try {
    const booking = await prisma.$transaction((tx) => createTicketBooking(tx, {
      eventId: id, ticketTypeId: body.ticketTypeId, fullName: body.fullName, phone: body.phone, email: body.email, quantity: Number(body.quantity) || 1,
    }))
    const qrDataUrl = await QRCode.toDataURL(booking.bookingNumber)
    return NextResponse.json({ booking, qrDataUrl }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'TICKET_TYPE_NOT_FOUND') return NextResponse.json({ error: 'Ticket type not found' }, { status: 404 })
    if (msg === 'SOLD_OUT') return NextResponse.json({ error: 'Not enough tickets remaining for this type' }, { status: 409 })
    throw err
  }
}
