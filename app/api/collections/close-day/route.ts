import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay } from 'date-fns'
import { getCollectionSessionTotals } from '@/lib/collection-session-totals'
import { resolveBusinessDate } from '@/lib/business-date'
import { getCompanyConfig } from '@/lib/company-config'

// Prisma client types for DayClosure are generated on deploy (vercel-build runs
// `prisma db push` + `prisma generate`); assert to avoid local type drift.
const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

const CAN_CLOSE = ['CASHIER', 'ACCOUNTANT', 'ADMIN']
const CAN_REOPEN = ['ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** Resolve which outlet the action applies to. Cashiers prefer their own token
 *  outlet, but fall back to the supplied one (derived from their own records)
 *  when the token has none. */
function resolveOutletId(user: { role: string; outletId?: string }, bodyOutletId?: string) {
  if (user.role === 'CASHIER') return user.outletId || bodyOutletId || null
  return bodyOutletId || user.outletId || null
}

/** GET — list closed day timestamps (start-of-day ISO) for the caller's outlet. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = user.role === 'CASHIER' ? user.outletId : (searchParams.get('outletId') || user.outletId)

  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId
  const closures = await db.dayClosure.findMany({ where, select: { date: true, outletId: true } })
  // Return calendar dates (yyyy-MM-dd) — stable across timezones.
  const closedDays: string[] = closures.map((c: { date: Date }) => new Date(c.date).toISOString().slice(0, 10))
  return NextResponse.json({ closedDays })
}

/** POST — close a day for an outlet. Body: { date, outletId? }. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_CLOSE.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const outletId = resolveOutletId(user, body.outletId)
  if (!outletId) return NextResponse.json({ error: 'Outlet required to close the day' }, { status: 400 })

  const day = body.date
    ? startOfDay(new Date(body.date))
    : resolveBusinessDate(new Date(), (await getCompanyConfig()).businessDayCutoverHour)

  // Validation: a day cannot be closed until both reconciliations are done.
  const range = { gte: startOfDay(day), lte: endOfDay(day) }
  const [cashRecon, digitalCount] = await Promise.all([
    prisma.cashRecon.findFirst({ where: { outletId, date: range }, select: { id: true } }),
    prisma.bankRecon.count({ where: { outletId, date: range, channel: { not: null } } }),
  ])
  if (!cashRecon) return NextResponse.json({ error: 'Cash Reconciliation must be completed before closing the day.' }, { status: 400 })
  if (digitalCount === 0) return NextResponse.json({ error: 'Digital Reconciliation must be completed before closing the day.' }, { status: 400 })

  const templateSessions = await getCollectionSessionTotals({ outletId, dateRange: range })
  if (templateSessions.some((s) => s.hasOpenWork)) {
    return NextResponse.json({ error: 'Complete all open Collection Template sessions before closing the day.' }, { status: 400 })
  }

  const closure = await db.dayClosure.upsert({
    where: { outletId_date: { outletId, date: day } },
    update: {}, // already closed — idempotent
    create: { outletId, date: day, closedBy: user.name || user.email || 'Unknown', closedById: user.userId },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CLOSE_DAY', entity: 'DayClosure', entityId: closure.id, details: `Closed ${day.toISOString().slice(0, 10)} for outlet ${outletId}` },
  })

  return NextResponse.json({ ok: true, closedDay: day.toISOString() })
}

/** DELETE — reopen a closed day (supervisors only). Query: ?date=&outletId= */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_REOPEN.includes(user.role)) {
    return NextResponse.json({ error: 'Only a supervisor can reopen a closed day' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId') || user.outletId
  if (!outletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })
  const day = searchParams.get('date')
    ? startOfDay(new Date(searchParams.get('date') as string))
    : resolveBusinessDate(new Date(), (await getCompanyConfig()).businessDayCutoverHour)

  await db.dayClosure.deleteMany({ where: { outletId, date: day } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'REOPEN_DAY', entity: 'DayClosure', entityId: `${outletId}`, details: `Reopened ${day.toISOString().slice(0, 10)} for outlet ${outletId}` },
  })

  return NextResponse.json({ ok: true, reopenedDay: day.toISOString() })
}
