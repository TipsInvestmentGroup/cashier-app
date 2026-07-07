import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, EVENT_STATUSES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

const parseDay = (s: string | null) => {
  if (!s) return null
  const p = parse(s, 'yyyy-MM-dd', new Date())
  return isValid(p) ? p : null
}

/** GET /api/events?from=&to=&status=&outletId= — list events with rolled-up totals. `status` accepts a comma-separated list. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = parseDay(searchParams.get('from'))
  const to = parseDay(searchParams.get('to'))
  const status = searchParams.get('status')
  const outletId = searchParams.get('outletId')

  const where: Record<string, unknown> = {}
  if (from && to) where.date = { gte: startOfDay(from), lte: endOfDay(to) }
  if (status) where.status = status.includes(',') ? { in: status.split(',') } : status
  if (outletId) where.outletId = outletId

  const events = await db.event.findMany({
    where,
    orderBy: { date: 'desc' },
    include: { staff: true, expenses: true, sponsors: true },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = events.map((e: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expenses = roundMoney(e.expenses.reduce((s: number, x: any) => s + (x.amount || 0), 0))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sponsorshipTotal = roundMoney(e.sponsors.reduce((s: number, x: any) => s + (x.sponsorshipValue || 0), 0))
    const grossRevenue = roundMoney((e.salesTotal || 0) + sponsorshipTotal)
    const profit = roundMoney(grossRevenue - expenses)
    return {
      id: e.id, name: e.name, clientName: e.clientName, location: e.location, date: e.date,
      startTime: e.startTime, endTime: e.endTime, expectedGuests: e.expectedGuests, status: e.status,
      salesTotal: roundMoney(e.salesTotal || 0), totalExpenses: expenses, profit,
      staffCount: e.staff.length,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      attendedCount: e.staff.filter((s: any) => s.attended).length,
    }
  })

  return NextResponse.json(rows)
}

/** POST /api/events — create an event. body: { name, clientName?, location?, date, startTime?, endTime?, expectedGuests?, notes?, outletId? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Only a manager, director or admin can create events' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const date = parseDay(body.date)
  if (!body.name?.trim() || !date) return NextResponse.json({ error: 'Event name and date are required' }, { status: 400 })
  const status = EVENT_STATUSES.includes(body.status) ? body.status : 'PLANNED'

  // Default the event to the "Tips Events" outlet when present.
  let outletId: string | null = body.outletId || null
  if (!outletId) {
    const ev = await prisma.outlet.findFirst({ where: { isEventsOnly: true }, select: { id: true } })
    outletId = ev?.id || null
  }

  const event = await db.event.create({
    data: {
      name: body.name.trim(),
      description: body.description?.trim() || null,
      eventType: body.eventType?.trim() || null,
      clientName: body.clientName?.trim() || null,
      location: body.location?.trim() || null,
      date: startOfDay(date),
      startTime: body.startTime || null,
      endTime: body.endTime || null,
      expectedGuests: Math.max(0, Math.round(Number(body.expectedGuests) || 0)),
      status,
      notes: body.notes?.trim() || null,
      outletId,
      createdById: user.userId,
    },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'Event', entityId: event.id, details: `Created event "${event.name}"` },
  })

  return NextResponse.json(event, { status: 201 })
}
