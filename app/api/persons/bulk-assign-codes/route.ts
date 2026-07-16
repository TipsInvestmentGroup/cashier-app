import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { nextFreePersonCode } from '@/lib/person-code'

const CAN_ASSIGN_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT']

/** Bulk-assigns sequential Person.code values to active persons that don't
 *  have one yet (Person Code / Bill Reference System — see
 *  lib/bill-reference.ts, lib/person-code.ts), optionally scoped to a single
 *  person `type`. Uses the same atomic per-scope counter the Bill Reference
 *  System uses internally, keyed `PERSONCODE:<type>`, so codes never
 *  collide with ones already handed out by the create/edit person endpoints. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (
    !CAN_ASSIGN_ROLES.includes(user.role) &&
    !(await canManagePersons(user.email)) &&
    !(await hasPermission(user.email, user.userId, RESOURCES.PERSONS, 'edit'))
  ) {
    return NextResponse.json({ error: 'You are not authorized to assign person codes' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const type: string | undefined = body?.type || undefined

  const result = await prisma.$transaction(async (tx) => {
    const targets = await tx.person.findMany({
      where: { code: null, isActive: true, ...(type ? { type } : {}) },
      select: { id: true, type: true, codeMode: true },
      orderBy: { createdAt: 'asc' },
    })

    let updated = 0
    for (const p of targets) {
      const code = await nextFreePersonCode(tx, p.type)
      // Only set codeMode when it's still the default — never overwrite an
      // already-explicit mode (MANUAL / EMPLOYEE_NUMBER / etc.) on a row that
      // simply hasn't been given a code yet.
      const codeModeUpdate = p.codeMode === 'AUTO' ? { codeMode: 'AUTO' } : {}
      await tx.person.update({ where: { id: p.id }, data: { code, ...codeModeUpdate } })
      updated++
    }

    if (updated > 0) {
      await tx.auditLog.create({
        data: {
          userId: user.userId,
          action: 'BULK_ASSIGN_CODES',
          entity: 'Person',
          details: `Auto-assigned codes to ${updated} person(s)${type ? ` of type ${type}` : ''}`,
        },
      })
    }

    return { updated }
  })

  return NextResponse.json(result)
}
