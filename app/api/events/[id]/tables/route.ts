import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const TABLE_STATUSES = ['AVAILABLE', 'RESERVED', 'OCCUPIED']

/** POST /api/events/[id]/tables — define a table. body: { name, tableType?, capacity?, price? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.name?.trim()) return NextResponse.json({ error: 'Table name is required' }, { status: 400 })

  const item = await db.eventTable.create({
    data: {
      eventId: id,
      name: body.name.trim(),
      tableType: body.tableType?.trim() || null,
      capacity: Math.max(1, Math.round(Number(body.capacity) || 4)),
      price: roundMoney(Number(body.price) || 0),
    },
  })
  return NextResponse.json(item, { status: 201 })
}

/** PATCH /api/events/[id]/tables — update a table (including manually flipping status). body: { tableId, name?, tableType?, capacity?, price?, status? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const body = await req.json().catch(() => ({}))
  if (!body.tableId) return NextResponse.json({ error: 'tableId is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.tableType !== undefined) data.tableType = body.tableType?.trim() || null
  if (body.capacity !== undefined) data.capacity = Math.max(1, Math.round(Number(body.capacity) || 1))
  if (body.price !== undefined) data.price = roundMoney(Number(body.price) || 0)
  if (body.status !== undefined) {
    if (!TABLE_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid table status' }, { status: 400 })
    data.status = body.status
  }

  const item = await db.eventTable.update({ where: { id: body.tableId }, data })
  return NextResponse.json(item)
}

/** DELETE /api/events/[id]/tables?tableId= */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const tableId = new URL(req.url).searchParams.get('tableId')
  if (!tableId) return NextResponse.json({ error: 'tableId required' }, { status: 400 })

  const bookingCount = await db.tableBooking.count({ where: { tableId, bookingStatus: { not: 'CANCELLED' } } })
  if (bookingCount > 0) return NextResponse.json({ error: 'Cannot delete a table with active bookings — cancel them first' }, { status: 409 })

  await db.eventTable.delete({ where: { id: tableId } })
  return NextResponse.json({ ok: true })
}
