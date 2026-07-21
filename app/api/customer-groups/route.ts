import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, CASHIER_ROLES, MGMT_ROLES } from '@/lib/auth'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** GET — customer groups (pricing segments) with member counts. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const rows = await db.customerGroup.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { persons: true, priceLists: true } } } })
  return NextResponse.json({ rows })
}

/** POST — create a customer group. Body: { name, code? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can manage customer groups.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  const created = await db.customerGroup.create({ data: { name: name.slice(0, 120), code: body.code ? String(body.code).slice(0, 40) : null, createdById: user.userId }, select: { id: true } })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'CustomerGroup', entityId: created.id, details: `Created customer group "${name}"` } })
  return NextResponse.json({ ok: true, id: created.id })
}
