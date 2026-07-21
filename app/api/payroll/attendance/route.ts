import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { upsertAttendance, dateOnly } from '@/lib/payroll-attendance'

// Attendance (Phase 4b). Supervisor-gated. POST upserts one row per
// [employee, day] (latest write wins); GET lists a window.
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const employeeId = searchParams.get('employeeId')
  if (!employeeId) return NextResponse.json({ error: 'employeeId is required' }, { status: 400 })
  const where: Record<string, unknown> = { employeeId }
  const from = searchParams.get('from'), to = searchParams.get('to')
  if (from || to) {
    const range: Record<string, Date> = {}
    if (from) range.gte = dateOnly(new Date(from))
    if (to) range.lte = dateOnly(new Date(to))
    where.date = range
  }
  const records = await prisma.attendanceRecord.findMany({ where, orderBy: { date: 'asc' }, take: 400 })
  return NextResponse.json({ records })
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const records = Array.isArray(body.records) ? body.records : []
  if (!records.length) return NextResponse.json({ error: 'records[] is required' }, { status: 400 })

  try {
    let n = 0
    for (const r of records) {
      if (!r.employeeId || !r.date) return NextResponse.json({ error: 'each record needs employeeId and date' }, { status: 400 })
      const date = new Date(r.date)
      if (isNaN(date.getTime())) return NextResponse.json({ error: `invalid date ${r.date}` }, { status: 400 })
      await upsertAttendance(prisma, { employeeId: r.employeeId, date, status: r.status, source: r.source ?? 'MANUAL', hoursWorked: r.hoursWorked, overtimeHours: r.overtimeHours, outletId: r.outletId, note: r.note })
      n++
    }
    return NextResponse.json({ ok: true, upserted: n })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to save attendance' }, { status: 400 })
  }
}
