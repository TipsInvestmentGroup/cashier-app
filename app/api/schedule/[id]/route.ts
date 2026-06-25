import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, SHIFT_TYPES, SCHEDULE_ROLES, type ShiftType } from '@/lib/scheduling'
import { startOfDay } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * PATCH /api/schedule/[id] — manager override of a single assignment.
 * body: { shiftType?, outletId?, role?, note? }. Any edit marks it MANUAL.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await db.scheduleAssignment.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = { source: 'MANUAL' }
  if (body.shiftType !== undefined) {
    if (!SHIFT_TYPES.includes(body.shiftType as ShiftType)) return NextResponse.json({ error: 'Invalid shift' }, { status: 400 })
    data.shiftType = body.shiftType
  }
  if (body.outletId !== undefined) data.outletId = body.outletId
  if (body.role !== undefined) {
    if (!SCHEDULE_ROLES.includes(body.role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    data.role = body.role
  }
  if (body.note !== undefined) data.note = body.note || null

  // Guard the per-day/per-shift uniqueness when moving shifts.
  const targetShift = data.shiftType || existing.shiftType
  if (targetShift !== existing.shiftType) {
    const clash = await db.scheduleAssignment.findFirst({
      where: { date: startOfDay(new Date(existing.date)), shiftType: targetShift, staffId: existing.staffId, id: { not: id } },
    })
    if (clash) return NextResponse.json({ error: 'Staff already has that shift this day' }, { status: 409 })
  }

  const item = await db.scheduleAssignment.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'ScheduleAssignment', entityId: id, details: `Override ${existing.staffName}` },
  })
  return NextResponse.json(item)
}

/** DELETE /api/schedule/[id] — remove a staff member from a slot. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await db.scheduleAssignment.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })

  await db.scheduleAssignment.delete({ where: { id } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'ScheduleAssignment', entityId: id, details: `Removed ${existing.staffName} from ${existing.shiftType}` },
  })
  return NextResponse.json({ ok: true })
}
