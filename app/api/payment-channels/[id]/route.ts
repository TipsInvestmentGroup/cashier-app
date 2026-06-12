import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'

/** Edit a channel (rename / activate) — authorized managers only. Code is immutable. */
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
    const item = await prisma.paymentChannel.update({ where: { id }, data })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'PaymentChannel', entityId: id, details: `Edited ${item.label}` } })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Could not update channel' }, { status: 400 })
  }
}

/** Delete a channel — authorized managers only. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { id } = await params
  await prisma.paymentChannel.delete({ where: { id } }).catch(() => null)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'PaymentChannel', entityId: id, details: 'Deleted channel' } })
  return NextResponse.json({ ok: true })
}
