import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'

/** Links signed bills that were saved with a free-text name (personId null)
 *  to an actual Person record, by exact personName + billType match. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'You are not authorized to link bills' }, { status: 403 })

  const { personName, billType, personId } = await req.json().catch(() => ({}))
  if (!personName || !billType || !personId) {
    return NextResponse.json({ error: 'personName, billType, and personId are required' }, { status: 400 })
  }

  const person = await prisma.person.findUnique({ where: { id: personId } })
  if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 })

  const result = await prisma.signedBill.updateMany({
    where: { personId: null, personName, billType },
    data: { personId },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'UPDATE',
      entity: 'Person',
      entityId: personId,
      details: `Linked ${result.count} unlinked "${personName}" (${billType}) signed bill(s) to ${person.name}`,
    },
  })

  return NextResponse.json({ ok: true, linked: result.count })
}
