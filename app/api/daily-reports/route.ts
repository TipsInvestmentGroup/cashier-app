import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, writeOutletId, readOutletScope, CASHIER_ROLES } from '@/lib/auth'
import { startOfDay, parse, isValid } from 'date-fns'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

function parseDate(s: string | null): Date | null { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? startOfDay(p) : null }

/** GET — the saved Daily Report for an outlet+date (draft or finalized), if any. ?date&outletId */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const date = parseDate(searchParams.get('date'))
  const outletId = readOutletScope(user, searchParams.get('outletId')) || user.outletId
  if (!date || !outletId) return NextResponse.json({ report: null })
  const report = await db.dailyReport.findUnique({ where: { outletId_date: { outletId, date } } })
  return NextResponse.json({ report })
}

/** POST — save (upsert) the report as a DRAFT. Body: { date, outletId?, data, notes? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const date = parseDate(body.date)
  const outletId = writeOutletId(user, body.outletId)
  if (!date || !outletId) return NextResponse.json({ error: 'A date and outlet are required.' }, { status: 400 })

  const existing = await db.dailyReport.findUnique({ where: { outletId_date: { outletId, date } }, select: { status: true } })
  if (existing?.status === 'FINALIZED') return NextResponse.json({ error: 'This report is finalized. Reopen it before editing.' }, { status: 409 })

  const dataStr = body.data ? (typeof body.data === 'string' ? body.data : JSON.stringify(body.data)) : null
  const report = await db.dailyReport.upsert({
    where: { outletId_date: { outletId, date } },
    update: { data: dataStr, notes: body.notes ?? null, status: 'DRAFT', needsReview: false, reviewReason: null, savedById: user.userId, savedByName: user.name || user.email || 'Unknown' },
    create: { outletId, date, data: dataStr, notes: body.notes ?? null, status: 'DRAFT', savedById: user.userId, savedByName: user.name || user.email || 'Unknown' },
    select: { id: true, status: true, needsReview: true },
  })
  return NextResponse.json({ ok: true, report })
}

/** PATCH — finalize or reopen. Body: { date, outletId?, action: 'finalize'|'reopen', data? } */
export async function PATCH(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const date = parseDate(body.date)
  const outletId = writeOutletId(user, body.outletId)
  const action = String(body.action || 'finalize')
  if (!date || !outletId) return NextResponse.json({ error: 'A date and outlet are required.' }, { status: 400 })

  if (action === 'reopen') {
    // Reopening a finalized report is a supervisor action.
    if (!requireRole(user, ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'])) return NextResponse.json({ error: 'Only a supervisor can reopen a finalized report.' }, { status: 403 })
    await db.dailyReport.update({ where: { outletId_date: { outletId, date } }, data: { status: 'DRAFT' } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'REOPEN', entity: 'DailyReport', details: `Reopened daily report ${outletId} ${date.toISOString().slice(0, 10)}` } })
    return NextResponse.json({ ok: true })
  }

  // Finalize (snapshot the latest computed data so historical reports stay fixed).
  const dataStr = body.data ? (typeof body.data === 'string' ? body.data : JSON.stringify(body.data)) : undefined
  const report = await db.dailyReport.upsert({
    where: { outletId_date: { outletId, date } },
    update: { status: 'FINALIZED', needsReview: false, reviewReason: null, finalizedById: user.userId, finalizedByName: user.name || user.email || 'Unknown', finalizedAt: new Date(), ...(dataStr !== undefined ? { data: dataStr } : {}) },
    create: { outletId, date, status: 'FINALIZED', data: dataStr ?? null, finalizedById: user.userId, finalizedByName: user.name || user.email || 'Unknown', finalizedAt: new Date(), savedById: user.userId, savedByName: user.name || user.email || 'Unknown' },
    select: { id: true, status: true },
  })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'FINALIZE', entity: 'DailyReport', entityId: report.id, details: `Finalized daily report ${outletId} ${date.toISOString().slice(0, 10)}` } })
  return NextResponse.json({ ok: true, report })
}
