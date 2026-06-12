import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageDepartments } from '@/lib/petty-access'

/** Edit a department (rename / activate) — authorized managers only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageDepartments(user.email))) return NextResponse.json({ error: 'You are not authorized to edit departments' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.isActive !== undefined) data.isActive = !!body.isActive

  try {
    const item = await prisma.department.update({ where: { id }, data })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'Department', entityId: id, details: `Edited ${item.name}` } })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Could not update department (name may be taken)' }, { status: 400 })
  }
}

/** Delete a department — authorized managers only. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageDepartments(user.email))) return NextResponse.json({ error: 'You are not authorized to delete departments' }, { status: 403 })

  const { id } = await params
  await prisma.department.delete({ where: { id } }).catch(() => null)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'Department', entityId: id, details: 'Deleted department' } })
  return NextResponse.json({ ok: true })
}
