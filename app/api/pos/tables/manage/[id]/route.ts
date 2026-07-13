import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MANAGE_ROLES = ['ADMIN']

/** PATCH /api/pos/tables/manage/[id] — edit number/label/capacity/isActive. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.posTable.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Table not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.number !== undefined) {
    const number = Math.round(Number(body.number))
    if (!Number.isFinite(number) || number <= 0) return NextResponse.json({ error: 'Table number must be a positive number' }, { status: 400 })
    const dupe = await prisma.posTable.findFirst({ where: { outletId: existing.outletId, number, id: { not: id } } })
    if (dupe) return NextResponse.json({ error: `Table ${number} already exists at this outlet` }, { status: 409 })
    data.number = number
  }
  if (body.label !== undefined) data.label = body.label?.trim() || null
  if (body.capacity !== undefined) data.capacity = Math.max(1, Math.round(Number(body.capacity)) || 4)
  if (body.isActive !== undefined) data.isActive = !!body.isActive

  const table = await prisma.posTable.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'PosTable', entityId: id, details: `Edited table ${table.number}` },
  })
  return NextResponse.json(table)
}

/** DELETE /api/pos/tables/manage/[id] — remove a table. Blocked if it has any order history. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.posTable.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Table not found' }, { status: 404 })

  const orderCount = await prisma.posOrder.count({ where: { tableId: id } })
  if (orderCount > 0) {
    return NextResponse.json({ error: 'This table has order history — deactivate it instead of deleting (to keep history).' }, { status: 409 })
  }

  await prisma.posTable.delete({ where: { id } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'PosTable', entityId: id, details: `Deleted table ${existing.number}` },
  })
  return NextResponse.json({ ok: true })
}
