import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma'
import { createTableBooking } from '@/lib/bookings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any
const BOOKABLE_STATUSES = ['PLANNED', 'CONFIRMED']

/** POST /api/public/events/[id]/tables — no auth. body: { tableId, name, phone, guests?, depositPaid?, specialRequests? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event || !BOOKABLE_STATUSES.includes(event.status)) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.tableId) return NextResponse.json({ error: 'tableId is required' }, { status: 400 })
  if (!body.name?.trim() || !body.phone?.trim()) return NextResponse.json({ error: 'Name and phone are required' }, { status: 400 })

  try {
    const booking = await prisma.$transaction((tx) => createTableBooking(tx, {
      eventId: id, tableId: body.tableId, name: body.name, phone: body.phone, guests: Number(body.guests) || 1,
      depositPaid: Number(body.depositPaid) || 0, specialRequests: body.specialRequests,
    }))
    const qrDataUrl = await QRCode.toDataURL(booking.bookingNumber)
    return NextResponse.json({ booking, qrDataUrl }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'TABLE_NOT_FOUND') return NextResponse.json({ error: 'Table not found' }, { status: 404 })
    if (msg === 'TABLE_UNAVAILABLE') return NextResponse.json({ error: 'That table is no longer available' }, { status: 409 })
    throw err
  }
}
