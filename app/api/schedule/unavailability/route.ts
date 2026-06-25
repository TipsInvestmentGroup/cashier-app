import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, SHIFT_TYPES, ABSENCE_REASONS, type ShiftType } from '@/lib/scheduling'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const parseDay = (s: string | null) => {
  if (!s) return null
  const p = parse(s, 'yyyy-MM-dd', new Date())
  return isValid(p) ? p : null
}

/** GET /api/schedule/unavailability?from=&to=&staffId= */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = parseDay(searchParams.get('from'))
  const to = parseDay(searchParams.get('to'))
  const staffId = searchParams.get('staffId')

  const where: Record<string, unknown> = {}
  if (from && to) where.date = { gte: startOfDay(from), lte: endOfDay(to) }
  if (staffId) where.staffId = staffId

  const rows = await db.staffUnavailability.findMany({ where, orderBy: { date: 'asc' } })
  return NextResponse.json(rows)
}

/** POST /api/schedule/unavailability — mark leave/absence. body: { staffId, date, shiftType?, reason?, note? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const date = parseDay(body.date)
  if (!body.staffId || !date) return NextResponse.json({ error: 'staffId and date are required' }, { status: 400 })

  const shiftType: string | null = body.shiftType || null
  if (shiftType && !SHIFT_TYPES.includes(shiftType as ShiftType)) return NextResponse.json({ error: 'Invalid shift' }, { status: 400 })
  const reason: string = ABSENCE_REASONS.includes(body.reason) ? body.reason : 'OTHER'

  const staff = await prisma.user.findUnique({ where: { id: body.staffId }, select: { id: true, name: true } })
  if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

  const day = startOfDay(date)
  const item = await db.staffUnavailability.create({
    data: { staffId: staff.id, staffName: staff.name, date: day, shiftType, reason, note: body.note || null, createdById: user.userId },
  })

  // Drop any auto-generated shift this exception now conflicts with so the
  // roster reflects the absence immediately. Manual placements are left for the
  // manager to reassign deliberately.
  await db.scheduleAssignment.deleteMany({
    where: { staffId: staff.id, date: day, source: 'AUTO', ...(shiftType ? { shiftType } : {}) },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'StaffUnavailability', entityId: item.id, details: `${staff.name} ${reason}${shiftType ? ` (${shiftType})` : ' (all day)'}` },
  })
  return NextResponse.json(item, { status: 201 })
}

/** DELETE /api/schedule/unavailability?id= */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.staffUnavailability.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
