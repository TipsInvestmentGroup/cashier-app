import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageDepartments } from '@/lib/petty-access'

/** Edit a function (rename / activate) — authorized managers only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageDepartments(user.email))) return NextResponse.json({ error: 'You are not authorized to edit functions' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.isActive !== undefined) data.isActive = !!body.isActive

  try {
    const item = await prisma.pettyFunction.update({ where: { id }, data })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'PettyFunction', entityId: id, details: `Edited ${item.name}` } })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Could not update function (name may be taken)' }, { status: 400 })
  }
}

/** Delete a function — authorized managers only. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageDepartments(user.email))) return NextResponse.json({ error: 'You are not authorized to delete functions' }, { status: 403 })

  const { id } = await params
  await prisma.pettyFunction.delete({ where: { id } }).catch(() => null)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'PettyFunction', entityId: id, details: 'Deleted function' } })
  return NextResponse.json({ ok: true })
}
