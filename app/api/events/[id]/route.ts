import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, EVENT_STATUSES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'
import { parse, isValid, startOfDay } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** GET /api/events/[id] — full event detail + financials report. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const event = await db.event.findUnique({
    where: { id },
    include: { staff: { orderBy: { staffName: 'asc' } }, expenses: { orderBy: { createdAt: 'asc' } } },
  })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalExpenses = roundMoney(event.expenses.reduce((s: number, x: any) => s + (x.amount || 0), 0))
  const salesTotal = roundMoney(event.salesTotal || 0)
  const profit = roundMoney(salesTotal - totalExpenses)
  const margin = salesTotal > 0 ? Math.round((profit / salesTotal) * 100) : 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attended = event.staff.filter((s: any) => s.attended).length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffSales = roundMoney(event.staff.reduce((s: number, x: any) => s + (x.salesAttributed || 0), 0))

  // Active staff available to assign (for the picker).
  const allStaff = await prisma.user.findMany({
    where: { isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' },
  })

  return NextResponse.json({
    ...event,
    allStaff,
    report: { salesTotal, totalExpenses, profit, margin, staffCount: event.staff.length, attended, staffSales },
  })
}

/** PATCH /api/events/[id] — update event fields, status, or sales total. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await db.event.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.clientName !== undefined) data.clientName = body.clientName?.trim() || null
  if (body.location !== undefined) data.location = body.location?.trim() || null
  if (body.startTime !== undefined) data.startTime = body.startTime || null
  if (body.endTime !== undefined) data.endTime = body.endTime || null
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null
  if (body.expectedGuests !== undefined) data.expectedGuests = Math.max(0, Math.round(Number(body.expectedGuests) || 0))
  if (body.salesTotal !== undefined) data.salesTotal = roundMoney(Number(body.salesTotal) || 0)
  if (body.status !== undefined) {
    if (!EVENT_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    data.status = body.status
  }
  if (body.date !== undefined) {
    const p = parse(body.date, 'yyyy-MM-dd', new Date())
    if (!isValid(p)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    data.date = startOfDay(p)
  }

  const event = await db.event.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'Event', entityId: id, details: `Updated event "${event.name}"` },
  })
  return NextResponse.json(event)
}

/** DELETE /api/events/[id] — remove an event (cascades staff & expenses). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await db.event.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  await db.event.delete({ where: { id } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'Event', entityId: id, details: `Deleted event "${existing.name}"` },
  })
  return NextResponse.json({ ok: true })
}
