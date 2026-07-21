import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, CASHIER_ROLES, MGMT_ROLES } from '@/lib/auth'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any
const parseD = (s: unknown) => { if (s === undefined) return undefined; if (!s) return null; const d = new Date(String(s)); return isNaN(d.getTime()) ? null : d }

/** GET — one price list with its items (product name/category joined). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params
  const pl = await db.priceList.findUnique({
    where: { id },
    include: {
      outlet: { select: { name: true } }, event: { select: { name: true } }, customerGroup: { select: { name: true } },
      items: { include: { product: { select: { name: true, code: true, buyingPrice: true, productCategory: { select: { label: true } } } } }, orderBy: { product: { name: 'asc' } } },
    },
  })
  if (!pl) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
  return NextResponse.json({ priceList: pl })
}

/**
 * PATCH — edit header, or act on the list.
 * Body: { action?: 'approve'|'reject'|'submit', ...header fields, reason? }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can edit price lists.' }, { status: 403 })
  const { id } = await params
  const pl = await db.priceList.findUnique({ where: { id }, select: { id: true, status: true, isDefault: true, name: true } })
  if (!pl) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  if (action === 'approve') {
    if (!requireRole(user, ['DIRECTOR', 'ADMIN', 'MANAGER'])) return NextResponse.json({ error: 'Only a manager/director can approve.' }, { status: 403 })
    await db.priceList.update({ where: { id }, data: { status: 'ACTIVE', approvedById: user.userId, approvedByName: user.name || user.email || 'Unknown', approvedAt: new Date() } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'APPROVE', entity: 'PriceList', entityId: id, details: `Approved price list "${pl.name}"` } })
    return NextResponse.json({ ok: true })
  }
  if (action === 'reject') {
    await db.priceList.update({ where: { id }, data: { status: 'REJECTED', approvedById: user.userId, approvedByName: user.name || user.email || 'Unknown', approvedAt: new Date() } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'REJECT', entity: 'PriceList', entityId: id, details: `Rejected price list "${pl.name}": ${String(body.reason || '').slice(0, 200)}` } })
    return NextResponse.json({ ok: true })
  }
  if (action === 'submit') {
    await db.priceList.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } })
    return NextResponse.json({ ok: true })
  }

  // Plain header edit.
  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 200)
  if ('description' in body) data.description = body.description ? String(body.description).slice(0, 500) : null
  if ('outletId' in body) data.outletId = body.outletId || null
  if ('eventId' in body) data.eventId = body.eventId || null
  if ('customerGroupId' in body) data.customerGroupId = body.customerGroupId || null
  if ('currency' in body) data.currency = (body.currency || 'TZS').toString().slice(0, 8)
  if ('effectiveFrom' in body) data.effectiveFrom = parseD(body.effectiveFrom)
  if ('effectiveTo' in body) data.effectiveTo = parseD(body.effectiveTo)
  if ('priority' in body && Number.isFinite(+body.priority)) data.priority = Math.trunc(+body.priority)
  if ('status' in body && ['ACTIVE', 'INACTIVE', 'PENDING_APPROVAL'].includes(body.status)) data.status = body.status
  await db.priceList.update({ where: { id }, data })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'PriceList', entityId: id, details: `Edited price list "${pl.name}"` } })
  return NextResponse.json({ ok: true })
}

/** DELETE — remove a price list (cascade items). The Default list cannot be deleted. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can delete price lists.' }, { status: 403 })
  const { id } = await params
  const pl = await db.priceList.findUnique({ where: { id }, select: { isDefault: true, name: true } })
  if (!pl) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
  if (pl.isDefault) return NextResponse.json({ error: 'The Default price list cannot be deleted.' }, { status: 409 })
  await db.priceList.delete({ where: { id } })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'PriceList', entityId: id, details: `Deleted price list "${pl.name}"` } })
  return NextResponse.json({ ok: true })
}
