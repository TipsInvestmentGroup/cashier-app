import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, MGMT_ROLES } from '@/lib/auth'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any
const parseD = (s: unknown) => { if (s === undefined) return undefined; if (!s) return null; const d = new Date(String(s)); return isNaN(d.getTime()) ? null : d }

/** PATCH — edit a promotion (any subset of fields). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can manage promotions.' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 200)
  if ('value' in body) data.value = Number(body.value) || 0
  if ('outletId' in body) data.outletId = body.outletId || null
  if ('eventId' in body) data.eventId = body.eventId || null
  if ('customerGroupId' in body) data.customerGroupId = body.customerGroupId || null
  if ('productId' in body) data.productId = body.productId || null
  if ('categoryId' in body) data.categoryId = body.categoryId || null
  if ('buyQty' in body) data.buyQty = body.buyQty != null ? Number(body.buyQty) : null
  if ('getQty' in body) data.getQty = body.getQty != null ? Number(body.getQty) : null
  if ('bundleConfig' in body) data.bundleConfig = body.bundleConfig ? (typeof body.bundleConfig === 'string' ? body.bundleConfig : JSON.stringify(body.bundleConfig)) : null
  if ('bundlePrice' in body) data.bundlePrice = body.bundlePrice != null ? Number(body.bundlePrice) : null
  if ('effectiveFrom' in body) data.effectiveFrom = parseD(body.effectiveFrom)
  if ('effectiveTo' in body) data.effectiveTo = parseD(body.effectiveTo)
  if ('status' in body && ['ACTIVE', 'INACTIVE'].includes(body.status)) data.status = body.status
  if ('priority' in body && Number.isFinite(+body.priority)) data.priority = Math.trunc(+body.priority)
  await db.promotion.update({ where: { id }, data })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'Promotion', entityId: id, details: 'Edited promotion' } })
  return NextResponse.json({ ok: true })
}

/** DELETE — remove a promotion. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can manage promotions.' }, { status: 403 })
  const { id } = await params
  await db.promotion.delete({ where: { id } })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'Promotion', entityId: id, details: 'Deleted promotion' } })
  return NextResponse.json({ ok: true })
}
