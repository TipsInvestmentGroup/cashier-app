import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, writeOutletId } from '@/lib/auth'
import { SALES_METRIC_DEPARTMENTS } from '@/lib/shared-constants'
import { startOfDay, parse, isValid } from 'date-fns'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any
const UPLOADERS = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

function parseInput(req: NextRequest, body: Record<string, unknown> | null) {
  const sp = req.nextUrl.searchParams
  const department = String((body?.department ?? sp.get('department')) || '').toUpperCase()
  const dateStr = String((body?.date ?? sp.get('date')) || '')
  const p = parse(dateStr, 'yyyy-MM-dd', new Date())
  const date = isValid(p) ? startOfDay(p) : null
  return { department, date, bodyOutletId: (body?.outletId as string) ?? sp.get('outletId') }
}

/** POST — lock a day's upload (any uploader). */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, UPLOADERS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { department, date, bodyOutletId } = parseInput(req, body)
  const outletId = writeOutletId(user, bodyOutletId)
  if (!(SALES_METRIC_DEPARTMENTS as readonly string[]).includes(department) || !date || !outletId) return NextResponse.json({ error: 'department, date and outlet are required' }, { status: 400 })

  await db.salesMetricLock.upsert({
    where: { outletId_department_date: { outletId, department, date } },
    update: {},
    create: { outletId, department, date, lockedBy: user.name || user.email || 'Unknown', lockedById: user.userId },
  })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'LOCK', entity: 'SalesMetric', details: `Locked ${department} ${date.toISOString().slice(0, 10)}` } })
  return NextResponse.json({ ok: true })
}

/** DELETE — unlock a day. Admin (super user) only. */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Only a super user (Admin) can unlock an upload.' }, { status: 403 })

  const { department, date, bodyOutletId } = parseInput(req, null)
  if (!department || !date || !bodyOutletId) return NextResponse.json({ error: 'department, date and outlet are required' }, { status: 400 })
  await db.salesMetricLock.deleteMany({ where: { outletId: bodyOutletId, department, date } })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'UNLOCK', entity: 'SalesMetric', details: `Unlocked ${department} ${date.toISOString().slice(0, 10)}` } })
  return NextResponse.json({ ok: true })
}
