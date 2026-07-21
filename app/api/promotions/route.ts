import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, CASHIER_ROLES, MGMT_ROLES } from '@/lib/auth'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any
const TYPES = ['PERCENTAGE', 'FIXED', 'BUY_X_GET_Y', 'BUNDLE']
const parseD = (s: unknown) => { if (!s) return null; const d = new Date(String(s)); return isNaN(d.getTime()) ? null : d }

/** GET — promotions with scope names. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const rows = await db.promotion.findMany({ orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }], include: { customerGroup: { select: { name: true } } } })
  return NextResponse.json({ rows })
}

/** POST — create a promotion. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can manage promotions.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const type = String(body.type || '').toUpperCase()
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  if (!TYPES.includes(type)) return NextResponse.json({ error: `type must be one of ${TYPES.join(', ')}` }, { status: 400 })

  const created = await db.promotion.create({
    data: {
      name: name.slice(0, 200), type,
      value: Number(body.value) || 0,
      outletId: body.outletId || null, eventId: body.eventId || null, customerGroupId: body.customerGroupId || null,
      productId: body.productId || null, categoryId: body.categoryId || null,
      buyQty: body.buyQty != null ? Number(body.buyQty) : null,
      getQty: body.getQty != null ? Number(body.getQty) : null,
      bundleConfig: body.bundleConfig ? (typeof body.bundleConfig === 'string' ? body.bundleConfig : JSON.stringify(body.bundleConfig)) : null,
      bundlePrice: body.bundlePrice != null ? Number(body.bundlePrice) : null,
      effectiveFrom: parseD(body.effectiveFrom), effectiveTo: parseD(body.effectiveTo),
      status: ['ACTIVE', 'INACTIVE'].includes(body.status) ? body.status : 'ACTIVE',
      priority: Number.isFinite(+body.priority) ? Math.trunc(+body.priority) : 0,
      createdById: user.userId, createdByName: user.name || user.email || 'Unknown',
    }, select: { id: true },
  })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'Promotion', entityId: created.id, details: `Created promotion "${name}" (${type})` } })
  return NextResponse.json({ ok: true, id: created.id })
}
