import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, requireRole } from '@/lib/auth'
import { computeActuals } from '@/lib/target-actuals'
import {
  generateWeekSchedule, SERVICE_ROLES, SCHEDULE_MANAGE_ROLES, SHIFT_TYPES, SCHEDULE_ROLES,
  DEFAULT_CONFIG, type ShiftType,
} from '@/lib/scheduling'
import { startOfDay, endOfDay, addDays, getDay, parse, isValid, subDays } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const parseDay = (s: string | null) => {
  if (!s) return null
  const p = parse(s, 'yyyy-MM-dd', new Date())
  return isValid(p) ? p : null
}

/**
 * GET /api/schedule?weekStart=YYYY-MM-DD&outletId=...
 * Returns the week's assignments and unavailability for the outlet, plus the
 * outlet's scheduler config.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const weekStart = parseDay(searchParams.get('weekStart')) || new Date()
  const from = startOfDay(weekStart)
  const to = endOfDay(addDays(from, 6))

  const where: Record<string, unknown> = { date: { gte: from, lte: to } }
  if (outletId) where.outletId = outletId

  const [assignments, unavailability, config, serviceStaff, allStaff] = await Promise.all([
    db.scheduleAssignment.findMany({ where, orderBy: [{ date: 'asc' }, { shiftType: 'asc' }] }),
    db.staffUnavailability.findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
    outletId ? db.outletScheduleConfig.findUnique({ where: { outletId } }) : null,
    // Auto-schedulable service staff (role WAITER) at the selected outlet.
    outletId
      ? prisma.user.findMany({ where: { outletId, isActive: true, role: { in: SERVICE_ROLES } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } })
      : Promise.resolve([]),
    // Everyone active — for manual assignment of any role / cross-outlet cover.
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true, outletId: true }, orderBy: { name: 'asc' } }),
  ])

  return NextResponse.json({
    weekStart: from,
    assignments,
    unavailability,
    config: config || (outletId ? { outletId, ...DEFAULT_CONFIG } : null),
    serviceStaff,
    allStaff,
  })
}

/**
 * POST /api/schedule
 *   body.mode = 'generate' → auto-build the week for an outlet:
 *     { mode:'generate', outletId, weekStart }
 *   otherwise → manual assignment (manager override):
 *     { date, shiftType, outletId, staffId, role?, note? }
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) {
    return NextResponse.json({ error: 'Only a manager, director or admin can edit schedules' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))

  if (body.mode === 'generate') return generate(user, body)
  return manualAssign(user, body)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generate(user: any, body: any) {
  const outletId: string | undefined = body.outletId
  const weekStart = parseDay(body.weekStart) || new Date()
  if (!outletId) return NextResponse.json({ error: 'Outlet is required' }, { status: 400 })

  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
  if (!outlet) return NextResponse.json({ error: 'Outlet not found' }, { status: 404 })
  if ((outlet as { isEventsOnly?: boolean }).isEventsOnly) {
    return NextResponse.json({ error: 'Events-only outlets are staffed per event, not on the weekly roster' }, { status: 400 })
  }

  const from = startOfDay(weekStart)
  const to = endOfDay(addDays(from, 6))
  const weekDows = Array.from({ length: 7 }, (_, i) => getDay(addDays(from, i)))

  // Schedulable service staff at this outlet.
  const staffUsers = await prisma.user.findMany({
    where: { outletId, isActive: true, role: { in: SERVICE_ROLES } },
    select: { id: true, name: true },
  })
  if (staffUsers.length === 0) {
    return NextResponse.json({ error: 'No active service staff (role WAITER) assigned to this outlet. Add staff or assign them manually.' }, { status: 400 })
  }

  // Performance signal: trailing 30-day collection actuals for this outlet.
  const actuals = await computeActuals({ from: subDays(from, 30), to: subDays(from, 1), outletId })
  const perfByName = new Map<string, number>()
  for (const s of actuals.byStaff[outletId] || []) perfByName.set(s.staffName.trim().toLowerCase(), s.collection)
  const staff = staffUsers.map((u) => ({ id: u.id, name: u.name, perf: perfByName.get(u.name.trim().toLowerCase()) || 0 }))

  // Unavailability within the week, mapped to day indices.
  const unavailRows = await db.staffUnavailability.findMany({ where: { date: { gte: from, lte: to } } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unavailable = unavailRows.map((u: any) => ({
    staffId: u.staffId,
    dayIndex: Math.round((startOfDay(new Date(u.date)).getTime() - from.getTime()) / 86400000),
    shiftType: (u.shiftType as ShiftType | null) ?? null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })).filter((u: any) => u.dayIndex >= 0 && u.dayIndex <= 6)

  const cfgRow = await db.outletScheduleConfig.findUnique({ where: { outletId } })
  const config = {
    morningWeight: cfgRow?.morningWeight ?? DEFAULT_CONFIG.morningWeight,
    eveningWeight: cfgRow?.eveningWeight ?? DEFAULT_CONFIG.eveningWeight,
    weekendMultiplier: cfgRow?.weekendMultiplier ?? DEFAULT_CONFIG.weekendMultiplier,
    daysOffPerWeek: cfgRow?.daysOffPerWeek ?? DEFAULT_CONFIG.daysOffPerWeek,
  }

  const generated = generateWeekSchedule({ staff, unavailable, config, weekDows })

  // Replace AUTO rows for this outlet/week, but PRESERVE manual overrides.
  const existing = await db.scheduleAssignment.findMany({ where: { outletId, date: { gte: from, lte: to } } })
  await db.scheduleAssignment.deleteMany({ where: { outletId, date: { gte: from, lte: to }, source: 'AUTO' } })

  // A staff member already placed manually that day keeps their manual slot;
  // skip any generated slot that would collide (unique is per date+shift+staff).
  const manualKey = new Set<string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    existing.filter((e: any) => e.source === 'MANUAL')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e: any) => `${startOfDay(new Date(e.date)).getTime()}:${e.staffId}`)
  )

  const rows = generated
    .map((g) => ({ ...g, date: startOfDay(addDays(from, g.dayIndex)) }))
    .filter((g) => !manualKey.has(`${g.date.getTime()}:${g.staffId}`))
    .map((g) => ({
      date: g.date, shiftType: g.shiftType, outletId, staffId: g.staffId, staffName: g.staffName,
      role: 'WAITER', source: 'AUTO', note: g.reason, createdById: user.userId,
    }))

  if (rows.length > 0) await db.scheduleAssignment.createMany({ data: rows })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'GENERATE', entity: 'ScheduleAssignment', entityId: outletId, details: `Auto-generated ${rows.length} shifts for ${outlet.name}` },
  })

  return NextResponse.json({ created: rows.length, staff: staff.length })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function manualAssign(user: any, body: any) {
  const { staffId, outletId, role = 'WAITER', note } = body
  const date = parseDay(body.date)
  const shiftType: string | undefined = body.shiftType
  if (!staffId || !outletId || !date || !shiftType) {
    return NextResponse.json({ error: 'staffId, outletId, date and shiftType are required' }, { status: 400 })
  }
  if (!SHIFT_TYPES.includes(shiftType as ShiftType)) return NextResponse.json({ error: 'Invalid shift' }, { status: 400 })
  if (!SCHEDULE_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const staff = await prisma.user.findUnique({ where: { id: staffId }, select: { id: true, name: true } })
  if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

  const day = startOfDay(date)

  // One slot per shift per day per staff — block the double-book.
  const clash = await db.scheduleAssignment.findFirst({ where: { date: day, shiftType, staffId } })
  if (clash) return NextResponse.json({ error: `${staff.name} is already scheduled for this shift` }, { status: 409 })

  // Conflict: staffer is working an event that day — they're off the roster.
  const onEvent = await db.eventStaff.findFirst({
    where: { staffId, event: { date: { gte: day, lte: endOfDay(date) } } },
    include: { event: { select: { name: true } } },
  })
  if (onEvent) return NextResponse.json({ error: `${staff.name} is assigned to event "${onEvent.event.name}" that day` }, { status: 409 })

  const item = await db.scheduleAssignment.create({
    data: { date: day, shiftType, outletId, staffId, staffName: staff.name, role, source: 'MANUAL', note: note || null, createdById: user.userId },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'ScheduleAssignment', entityId: item.id, details: `Assigned ${staff.name} to ${shiftType} (manual)` },
  })

  return NextResponse.json(item, { status: 201 })
}
