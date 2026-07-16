import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { findDuplicatePersonByName } from '@/lib/persons-dedupe'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { PERSON_NUMBERING_MODES } from '@/lib/bill-reference-defaults'
import { nextFreePersonCode } from '@/lib/person-code'

const CODE_MODES: readonly string[] = PERSON_NUMBERING_MODES

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  const persons = await prisma.person.findMany({
    where: type ? { type, isActive: true } : { isActive: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(persons)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'ACCOUNTANT', 'MANAGER'].includes(user.role) && !(await hasPermission(user.email, user.userId, RESOURCES.PERSONS, 'add'))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { name, phone, email, type, creditLimit } = body

  if (body.codeMode !== undefined && !CODE_MODES.includes(body.codeMode)) {
    return NextResponse.json({ error: `Invalid codeMode. Must be one of: ${CODE_MODES.join(', ')}` }, { status: 400 })
  }
  const codeMode: string = body.codeMode || 'AUTO'
  const explicitCode: string | null = body.code ? String(body.code).trim() : null

  const dup = await findDuplicatePersonByName(name)
  if (dup) {
    return NextResponse.json({ error: `A person named "${dup.name}" already exists. Use Merge People instead of creating a duplicate.` }, { status: 409 })
  }

  if (explicitCode) {
    const codeClash = await prisma.person.findFirst({ where: { type, code: explicitCode } })
    if (codeClash) {
      return NextResponse.json({ error: `Code "${explicitCode}" is already used by "${codeClash.name}" in this person type.` }, { status: 409 })
    }
  }

  try {
    const person = await prisma.$transaction(async (tx) => {
      // Auto-assign a sequential code immediately when the person is left in
      // AUTO mode with no explicit code — avoids leaving new persons codeless
      // until someone runs "Auto-assign codes" (see bulk-assign-codes route).
      const code = explicitCode || (codeMode === 'AUTO' ? await nextFreePersonCode(tx, type) : null)
      return tx.person.create({
        data: { name, phone, email, type, creditLimit: Number(creditLimit) || 0, code, codeMode },
      })
    })
    return NextResponse.json(person, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('Unique')) {
      return NextResponse.json({ error: 'That code is already used by another person of this type.' }, { status: 409 })
    }
    throw err
  }
}
