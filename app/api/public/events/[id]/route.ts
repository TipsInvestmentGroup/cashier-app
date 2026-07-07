import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

// No auth on this route by design — it's the public booking page's data
// source. Only expose what a customer needs to book; never internal fields
// (createdById, notes, salesTotal, etc).
const BOOKABLE_STATUSES = ['PLANNED', 'CONFIRMED']

/** GET /api/public/events/[id] — public event info + bookable ticket types & tables. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const event = await db.event.findUnique({
    where: { id },
    include: {
      ticketTypes: { orderBy: { createdAt: 'asc' } },
      tickets: { select: { ticketTypeId: true, quantity: true, bookingStatus: true } },
      tables: { orderBy: { createdAt: 'asc' } },
    },
  })
  // Same 404 whether the event doesn't exist or isn't currently bookable —
  // this endpoint can't be used to probe internal event states.
  if (!event || !BOOKABLE_STATUSES.includes(event.status)) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const activeTickets = event.tickets.filter((t: { bookingStatus: string }) => t.bookingStatus !== 'CANCELLED')
  const ticketTypes = event.ticketTypes.map((tt: { id: string; name: string; price: number; quantityAvailable: number | null }) => {
    const sold = activeTickets.filter((t: { ticketTypeId: string }) => t.ticketTypeId === tt.id).reduce((s: number, t: { quantity: number }) => s + (t.quantity || 0), 0)
    const remaining = tt.quantityAvailable == null ? null : Math.max(0, tt.quantityAvailable - sold)
    return { id: tt.id, name: tt.name, price: tt.price, remaining }
  })

  const tables = event.tables.map((t: { id: string; name: string; tableType: string | null; capacity: number; price: number; status: string }) => ({
    id: t.id, name: t.name, tableType: t.tableType, capacity: t.capacity, price: t.price, status: t.status,
  }))

  return NextResponse.json({
    id: event.id,
    name: event.name,
    description: event.description,
    eventType: event.eventType,
    location: event.location,
    date: event.date,
    startTime: event.startTime,
    endTime: event.endTime,
    ticketTypes,
    tables,
  })
}
