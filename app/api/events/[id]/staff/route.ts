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
  // Stable marker embedded in the unavailability note — matched later by
  // eventId, not by the event's (editable) name, so renaming the event after
  // assigning staff can't orphan the cleanup in DELETE below.
  const eventTag = `[eventId:${event.id}]`

  try {
    const result = await prisma.$transaction(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tdb = tx as any

      // Both conflict checks now run inside the same transaction as the
      // insert — previously they ran beforehand as separate queries, so two
      // concurrent assignments (two managers, two tabs) could each pass the
      // checks before either committed, double-booking the same staffer
      // across two events the same day.
      const dupe = await tdb.eventStaff.findFirst({ where: { eventId: id, staffId: staff.id } })
      if (dupe) throw new Error(`ALREADY_ON_EVENT`)

      const otherEvent = await tdb.eventStaff.findFirst({
        where: { staffId: staff.id, event: { date: { gte: day, lte: dayEnd } }, eventId: { not: id } },
        include: { event: { select: { name: true } } },
      })
      if (otherEvent) throw new Error(`OTHER_EVENT:${otherEvent.event.name}`)

      // A manager's deliberate MANUAL shift shouldn't vanish silently just
      // because the same staffer is also being sent to an event — block and
      // ask the manager to resolve it explicitly instead.
      const manualShift = await tdb.scheduleAssignment.findFirst({
        where: { staffId: staff.id, date: { gte: day, lte: dayEnd }, source: 'MANUAL' },
      })
      if (manualShift) throw new Error(`HAS_MANUAL_SHIFT:${manualShift.shiftType}`)

      const assignment = await tdb.eventStaff.create({
        data: { eventId: id, staffId: staff.id, staffName: staff.name, role },
      })

      // Pull the staffer off their (AUTO-generated) roster for the event day.
      const removed = await tdb.scheduleAssignment.deleteMany({
        where: { staffId: staff.id, date: { gte: day, lte: dayEnd }, source: 'AUTO' },
      })

      // Record a whole-day unavailability so auto-generation won't re-roster them
      // (skip if one already exists for the day).
      const existingUnavail = await tdb.staffUnavailability.findFirst({
        where: { staffId: staff.id, date: { gte: day, lte: dayEnd }, shiftType: null },
      })
      if (!existingUnavail) {
        await tdb.staffUnavailability.create({
          data: { staffId: staff.id, staffName: staff.name, date: day, shiftType: null, reason: 'OTHER', note: `Working event: ${event.name} ${eventTag}`, createdById: user.userId },
        })
      }
      return { assignment, removedShifts: removed.count }
    })

    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'EventStaff', entityId: result.assignment.id, details: `Assigned ${staff.name} to event "${event.name}" (removed ${result.removedShifts} roster shift(s))` },
    })

    return NextResponse.json({ ...result.assignment, removedShifts: result.removedShifts }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : ''
    if (msg === 'ALREADY_ON_EVENT') return NextResponse.json({ error: `${staff.name} is already on this event` }, { status: 409 })
    if (msg.startsWith('OTHER_EVENT:')) return NextResponse.json({ error: `${staff.name} is already assigned to event "${msg.slice('OTHER_EVENT:'.length)}" that day` }, { status: 409 })
    if (msg.startsWith('HAS_MANUAL_SHIFT:')) return NextResponse.json({ error: `${staff.name} has a manually-assigned ${msg.slice('HAS_MANUAL_SHIFT:'.length)} shift that day — remove or reassign it first.` }, { status: 409 })
    throw err
  }
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
    // Lift the auto-added "working event" unavailability so they can be
    // re-rostered. Matched by the stable [eventId:...] tag embedded in the
    // note, not by the event's name — renaming the event between assigning
    // and removing staff used to make this match fail silently, permanently
    // stranding the unavailability row (and the staffer) forever.
    const day = startOfDay(new Date(existing.event.date))
    const dayEnd = endOfDay(new Date(existing.event.date))
    await tdb.staffUnavailability.deleteMany({
      where: { staffId: existing.staffId, date: { gte: day, lte: dayEnd }, shiftType: null, note: { contains: `[eventId:${existing.eventId}]` } },
    })
  })

  return NextResponse.json({ ok: true })
}
