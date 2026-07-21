import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, MGMT_ROLES } from '@/lib/auth'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** PATCH — edit a customer group. Body: { name?, code?, isActive? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can manage customer groups.' }, { status: 403 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120)
  if ('code' in body) data.code = body.code ? String(body.code).slice(0, 40) : null
  if ('isActive' in body) data.isActive = !!body.isActive
  await db.customerGroup.update({ where: { id }, data })
  return NextResponse.json({ ok: true })
}

/** DELETE — remove a customer group (unlinks members via SetNull is not set; block if in use). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can manage customer groups.' }, { status: 403 })
  const { id } = await params
  const [persons, lists] = await Promise.all([
    db.person.count({ where: { customerGroupId: id } }),
    db.priceList.count({ where: { customerGroupId: id } }),
  ])
  if (persons > 0 || lists > 0) return NextResponse.json({ error: `In use by ${persons} member(s) and ${lists} price list(s). Reassign them first.` }, { status: 409 })
  await db.customerGroup.delete({ where: { id } })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'CustomerGroup', entityId: id, details: 'Deleted customer group' } })
  return NextResponse.json({ ok: true })
}
