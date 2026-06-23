import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

// SalesMetric client types are generated on deploy; assert to avoid local drift.
const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any
const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** GET — list/aggregate uploaded metrics. ?department=SHISHA|FOOD&from=&to=&outletId= */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const department = searchParams.get('department') || undefined
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const from = parseD(searchParams.get('from'))
  const to = parseD(searchParams.get('to'))

  const where: Record<string, unknown> = {}
  if (department) where.department = department
  if (outletId) where.outletId = outletId
  if (from && to) where.date = { gte: startOfDay(from), lte: endOfDay(to) }

  const rows = await db.salesMetric.findMany({ where, orderBy: { date: 'desc' }, take: 500, include: { outlet: { select: { name: true } } } })
  return NextResponse.json({ rows })
}

/** POST — bulk upload. Body: { department, outletId, rows: [{date, staffName, value}] } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const department = String(body.department || '').toUpperCase()
  if (!['SHISHA', 'FOOD'].includes(department)) return NextResponse.json({ error: 'department must be SHISHA or FOOD' }, { status: 400 })
  const outletId = body.outletId || null
  const rawRows: { date?: string; staffName?: string; value?: number | string }[] = Array.isArray(body.rows) ? body.rows : []

  const data = rawRows
    .map((r) => {
      const d = r.date ? new Date(r.date) : null
      const value = roundMoney(Number(r.value) || 0)
      const staffName = String(r.staffName || '').trim()
      if (!d || isNaN(d.getTime()) || !staffName || value <= 0) return null
      return { date: d, outletId, department, staffName, value, createdById: user.userId }
    })
    .filter(Boolean) as { date: Date; outletId: string | null; department: string; staffName: string; value: number; createdById: string }[]

  if (!data.length) return NextResponse.json({ error: 'No valid rows found. Each row needs a date, staff name and a value > 0.' }, { status: 400 })

  await db.salesMetric.createMany({ data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPLOAD', entity: 'SalesMetric', details: `Uploaded ${data.length} ${department} sales rows` },
  })

  return NextResponse.json({ ok: true, inserted: data.length })
}

/** DELETE — remove one row (?id=) or many (body { ids: [...] }). Cashiers limited to their outlet. */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const body = id ? null : await req.json().catch(() => ({}))
  const ids: string[] = id ? [id] : (Array.isArray(body?.ids) ? body.ids : [])
  if (!ids.length) return NextResponse.json({ error: 'Nothing to delete' }, { status: 400 })

  // Cashiers may only delete rows from their own outlet.
  const where: Record<string, unknown> = { id: { in: ids } }
  if (user.role === 'CASHIER') where.outletId = user.outletId || '__none__'

  const res = await db.salesMetric.deleteMany({ where })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'SalesMetric', details: `Deleted ${res.count} uploaded sales row(s)` },
  })
  return NextResponse.json({ ok: true, deleted: res.count })
}
