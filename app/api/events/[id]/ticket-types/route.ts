import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** POST /api/events/[id]/ticket-types — define a ticket type. body: { name, price?, quantityAvailable? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.name?.trim()) return NextResponse.json({ error: 'Ticket type name is required' }, { status: 400 })

  const item = await db.eventTicketType.create({
    data: {
      eventId: id,
      name: body.name.trim(),
      price: roundMoney(Number(body.price) || 0),
      quantityAvailable: body.quantityAvailable !== undefined && body.quantityAvailable !== '' && body.quantityAvailable !== null
        ? Math.max(0, Math.round(Number(body.quantityAvailable)))
        : null,
    },
  })
  return NextResponse.json(item, { status: 201 })
}

/** PATCH /api/events/[id]/ticket-types — update a ticket type. body: { ticketTypeId, name?, price?, quantityAvailable? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const body = await req.json().catch(() => ({}))
  if (!body.ticketTypeId) return NextResponse.json({ error: 'ticketTypeId is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.price !== undefined) data.price = roundMoney(Number(body.price) || 0)
  if (body.quantityAvailable !== undefined) {
    data.quantityAvailable = body.quantityAvailable === '' || body.quantityAvailable === null ? null : Math.max(0, Math.round(Number(body.quantityAvailable)))
  }

  const item = await db.eventTicketType.update({ where: { id: body.ticketTypeId }, data })
  return NextResponse.json(item)
}

/** DELETE /api/events/[id]/ticket-types?ticketTypeId= */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const ticketTypeId = new URL(req.url).searchParams.get('ticketTypeId')
  if (!ticketTypeId) return NextResponse.json({ error: 'ticketTypeId required' }, { status: 400 })

  const bookingCount = await db.ticketBooking.count({ where: { ticketTypeId, bookingStatus: { not: 'CANCELLED' } } })
  if (bookingCount > 0) return NextResponse.json({ error: 'Cannot delete a ticket type with active bookings — cancel them first' }, { status: 409 })

  await db.eventTicketType.delete({ where: { id: ticketTypeId } })
  return NextResponse.json({ ok: true })
}
