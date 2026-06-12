import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'

/** Edit a category (rename / activate) — authorized managers only. Code is immutable. */
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
    const item = await prisma.personCategory.update({ where: { id }, data })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'PersonCategory', entityId: id, details: `Edited ${item.label}` } })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Could not update category' }, { status: 400 })
  }
}

/** Delete a category — authorized managers only. Blocks if persons or bills use it. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { id } = await params
  const cat = await prisma.personCategory.findUnique({ where: { id } })
  if (!cat) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const [persons, bills] = await Promise.all([
    prisma.person.count({ where: { type: cat.code } }),
    prisma.signedBill.count({ where: { billType: cat.code } }),
  ])
  if (persons + bills > 0) {
    return NextResponse.json({ error: 'This category is in use by persons or bills — disable it instead of deleting.' }, { status: 409 })
  }
  await prisma.personCategory.delete({ where: { id } }).catch(() => null)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'PersonCategory', entityId: id, details: `Deleted ${cat.label}` } })
  return NextResponse.json({ ok: true })
}
