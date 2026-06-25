import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, EVENT_ROLES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * POST /api/events/[id]/staff — assign a staff member to the event.
 * body: { staffId, role? }
 *
 * Enforces the spec's two rules:
 *  • Conflict prevention — a staffer already booked on ANOTHER event the same
 *    day is rejected.
 *  • Roster removal — the staffer's regular roster shifts for the event day are
 *    deleted, and a whole-day unavailability is recorded so the auto-scheduler
 *    won't put them back.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const role = EVENT_ROLES.includes(body.role) ? body.role : 'WAITER'
  if (!body.staffId) return NextResponse.json({ error: 'staffId is required' }, { status: 400 })

  const staff = await prisma.user.findUnique({ where: { id: body.staffId }, select: { id: true, name: true } })
  if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

  const day = startOfDay(new Date(event.date))
  const dayEnd = endOfDay(new Date(event.date))

  // Already on this event?
  const dupe = await db.eventStaff.findFirst({ where: { eventId: id, staffId: staff.id } })
  if (dupe) return NextResponse.json({ error: `${staff.name} is already on this event` }, { status: 409 })

  // Conflict: booked on another event the same day.
  const otherEvent = await db.eventStaff.findFirst({
    where: { staffId: staff.id, event: { date: { gte: day, lte: dayEnd } }, eventId: { not: id } },
    include: { event: { select: { name: true } } },
  })
  if (otherEvent) {
    return NextResponse.json({ error: `${staff.name} is already assigned to event "${otherEvent.event.name}" that day` }, { status: 409 })
  }

  const result = await prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tdb = tx as any
    const assignment = await tdb.eventStaff.create({
      data: { eventId: id, staffId: staff.id, staffName: staff.name, role },
    })

    // Pull the staffer off their regular roster for the event day.
    const removed = await tdb.scheduleAssignment.deleteMany({ where: { staffId: staff.id, date: { gte: day, lte: dayEnd } } })

    // Record a whole-day unavailability so auto-generation won't re-roster them
    // (skip if one already exists for the day).
    const existingUnavail = await tdb.staffUnavailability.findFirst({
      where: { staffId: staff.id, date: { gte: day, lte: dayEnd }, shiftType: null },
    })
    if (!existingUnavail) {
      await tdb.staffUnavailability.create({
        data: { staffId: staff.id, staffName: staff.name, date: day, shiftType: null, reason: 'OTHER', note: `Working event: ${event.name}`, createdById: user.userId },
      })
    }
    return { assignment, removedShifts: removed.count }
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'EventStaff', entityId: result.assignment.id, details: `Assigned ${staff.name} to event "${event.name}" (removed ${result.removedShifts} roster shift(s))` },
  })

  return NextResponse.json({ ...result.assignment, removedShifts: result.removedShifts }, { status: 201 })
}

/** PATCH /api/events/[id]/staff — update attendance / sales / role. body: { assignId, attended?, salesAttributed?, role?, performanceNote? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const body = await req.json().catch(() => ({}))
  if (!body.assignId) return NextResponse.json({ error: 'assignId is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.attended !== undefined) data.attended = !!body.attended
  if (body.salesAttributed !== undefined) data.salesAttributed = roundMoney(Number(body.salesAttributed) || 0)
  if (body.performanceNote !== undefined) data.performanceNote = body.performanceNote?.trim() || null
  if (body.role !== undefined) {
    if (!EVENT_ROLES.includes(body.role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    data.role = body.role
  }

  const item = await db.eventStaff.update({ where: { id: body.assignId }, data })
  return NextResponse.json(item)
}

/** DELETE /api/events/[id]/staff?assignId= — unassign a staff member. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const assignId = new URL(req.url).searchParams.get('assignId')
  if (!assignId) return NextResponse.json({ error: 'assignId required' }, { status: 400 })

  const existing = await db.eventStaff.findUnique({ where: { id: assignId }, include: { event: { select: { name: true, date: true } } } })
  if (!existing) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tdb = tx as any
    await tdb.eventStaff.delete({ where: { id: assignId } })
    // Lift the auto-added "working event" unavailability so they can be re-rostered.
    const day = startOfDay(new Date(existing.event.date))
    const dayEnd = endOfDay(new Date(existing.event.date))
    await tdb.staffUnavailability.deleteMany({
      where: { staffId: existing.staffId, date: { gte: day, lte: dayEnd }, shiftType: null, note: `Working event: ${existing.event.name}` },
    })
  })

  return NextResponse.json({ ok: true })
}
