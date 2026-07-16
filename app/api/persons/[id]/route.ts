import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'
import { findDuplicatePersonByName } from '@/lib/persons-dedupe'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { PERSON_NUMBERING_MODES } from '@/lib/bill-reference-defaults'
import { nextFreePersonCode } from '@/lib/person-code'

const CODE_MODES: readonly string[] = PERSON_NUMBERING_MODES

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

  if (body.codeMode !== undefined && !CODE_MODES.includes(body.codeMode)) {
    return NextResponse.json({ error: `Invalid codeMode. Must be one of: ${CODE_MODES.join(', ')}` }, { status: 400 })
  }

  const existing = await prisma.person.findUnique({ where: { id }, select: { type: true, code: true, codeMode: true } })
  if (!existing) return NextResponse.json({ error: 'Person not found' }, { status: 404 })

  const targetType: string = body.type !== undefined ? body.type : existing.type
  const touchesCode = body.code !== undefined || body.codeMode !== undefined
  const explicitCode: string | null | undefined = body.code !== undefined ? (body.code ? String(body.code).trim() : null) : undefined
  const resolvedCodeMode: string = body.codeMode !== undefined ? body.codeMode : existing.codeMode

  if (explicitCode) {
    const codeClash = await prisma.person.findFirst({ where: { type: targetType, code: explicitCode, NOT: { id } } })
    if (codeClash) {
      return NextResponse.json({ error: `Code "${explicitCode}" is already used by "${codeClash.name}" in this person type.` }, { status: 409 })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = body.name
  if (body.phone !== undefined) data.phone = body.phone || null
  if (body.email !== undefined) data.email = body.email || null
  if (body.type !== undefined) data.type = body.type
  if (body.creditLimit !== undefined) data.creditLimit = Number(body.creditLimit) || 0
  if (body.isActive !== undefined) data.isActive = !!body.isActive
  if (body.codeMode !== undefined) data.codeMode = resolvedCodeMode
  if (explicitCode !== undefined) data.code = explicitCode

  try {
    const person = await prisma.$transaction(async (tx) => {
      // Only auto-assign when this request actually touches code/codeMode,
      // no explicit code was given, the resulting mode is AUTO, and the
      // person doesn't already have a code — otherwise an unrelated edit
      // (e.g. just the phone number) would silently mint a code.
      if (touchesCode && data.code === undefined && resolvedCodeMode === 'AUTO' && !existing.code) {
        data.code = await nextFreePersonCode(tx, targetType)
      }
      const updated = await tx.person.update({ where: { id }, data })
      await tx.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'Person', entityId: id, details: `Edited ${updated.name}` } })
      return updated
    })
    return NextResponse.json(person)
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique')) {
      return NextResponse.json({ error: 'That code is already used by another person of this type.' }, { status: 409 })
    }
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
