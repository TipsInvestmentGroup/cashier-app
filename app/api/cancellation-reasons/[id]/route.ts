import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'

/** Edit a reason (rename / activate) — authorized managers only. Code is immutable. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.label !== undefined) data.label = String(body.label).trim()
  if (body.isActive !== undefined) data.isActive = !!body.isActive

  try {
    const item = await prisma.cancellationReason.update({ where: { id }, data })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'CancellationReason', entityId: id, details: `Edited ${item.label}` } })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Could not update reason' }, { status: 400 })
  }
}

/** Delete a reason — authorized managers only. Blocks if any cancellation uses it. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { id } = await params
  const reason = await prisma.cancellationReason.findUnique({ where: { id } })
  if (!reason) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const inUse = await prisma.cancellation.count({ where: { reason: reason.label } })
  if (inUse > 0) {
    return NextResponse.json({ error: 'This reason is in use by cancellations — disable it instead of deleting.' }, { status: 409 })
  }
  await prisma.cancellationReason.delete({ where: { id } }).catch(() => null)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'CancellationReason', entityId: id, details: `Deleted ${reason.label}` } })
  return NextResponse.json({ ok: true })
}
