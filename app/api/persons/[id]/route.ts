import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'
import { findDuplicatePersonByName } from '@/lib/persons-dedupe'
import { hasPermission, RESOURCES } from '@/lib/rbac'

/** Edit a person — owner / r.mlay / owner-chosen manager / RBAC-granted user. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email)) && !(await hasPermission(user.email, user.userId, RESOURCES.PERSONS, 'edit'))) {
    return NextResponse.json({ error: 'You are not authorized to edit persons' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()

  if (body.name !== undefined) {
    const dup = await findDuplicatePersonByName(body.name, id)
    if (dup) return NextResponse.json({ error: `A person named "${dup.name}" already exists. Use Merge People instead of creating a duplicate.` }, { status: 409 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = body.name
  if (body.phone !== undefined) data.phone = body.phone || null
  if (body.email !== undefined) data.email = body.email || null
  if (body.type !== undefined) data.type = body.type
  if (body.creditLimit !== undefined) data.creditLimit = Number(body.creditLimit) || 0
  if (body.isActive !== undefined) data.isActive = !!body.isActive

  try {
    const person = await prisma.person.update({ where: { id }, data })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'Person', entityId: id, details: `Edited ${person.name}` } })
    return NextResponse.json(person)
  } catch {
    return NextResponse.json({ error: 'Could not update person' }, { status: 400 })
  }
}

/** Delete a person — authorized users only. Blocks if linked to bills. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email)) && !(await hasPermission(user.email, user.userId, RESOURCES.PERSONS, 'delete'))) {
    return NextResponse.json({ error: 'You are not authorized to delete persons' }, { status: 403 })
  }

  const { id } = await params
  const [signed, paid] = await Promise.all([
    prisma.signedBill.count({ where: { personId: id } }),
    prisma.paidBill.count({ where: { personId: id } }),
  ])
  if (signed + paid > 0) {
    return NextResponse.json({ error: 'This person has linked bills — deactivate them instead of deleting (to keep history).' }, { status: 409 })
  }
  await prisma.person.delete({ where: { id } }).catch(() => null)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'Person', entityId: id, details: 'Deleted person' } })
  return NextResponse.json({ ok: true })
}
