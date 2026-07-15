import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'

/** Merge 2+ person records into one: reassigns all signed/paid bills to the
 *  kept record, keeps the highest credit limit among the merged records, and
 *  deactivates the rest (soft — history stays intact). */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'You are not authorized to merge persons' }, { status: 403 })

  const { keepId, mergeIds } = await req.json().catch(() => ({}))
  const ids: string[] = Array.isArray(mergeIds) ? mergeIds.filter((id) => id && id !== keepId) : []
  if (!keepId || ids.length === 0) {
    return NextResponse.json({ error: 'Select one person to keep and at least one other to merge into it' }, { status: 400 })
  }

  const people = await prisma.person.findMany({ where: { id: { in: [keepId, ...ids] } } })
  const keep = people.find((p) => p.id === keepId)
  if (!keep || people.length !== ids.length + 1) {
    return NextResponse.json({ error: 'One or more selected persons were not found' }, { status: 404 })
  }

  const bestCreditLimit = Math.max(...people.map((p) => p.creditLimit))

  const [signedResult, paidResult] = await prisma.$transaction([
    prisma.signedBill.updateMany({ where: { personId: { in: ids } }, data: { personId: keepId } }),
    prisma.paidBill.updateMany({ where: { personId: { in: ids } }, data: { personId: keepId } }),
    prisma.person.update({ where: { id: keepId }, data: { creditLimit: bestCreditLimit } }),
    prisma.person.updateMany({ where: { id: { in: ids } }, data: { isActive: false } }),
  ])

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'UPDATE',
      entity: 'Person',
      entityId: keepId,
      details: `Merged ${people.filter((p) => p.id !== keepId).map((p) => p.name).join(', ')} into ${keep.name} (${signedResult.count} signed bills, ${paidResult.count} paid bills reassigned)`,
    },
  })

  const merged = await prisma.person.findUnique({ where: { id: keepId } })
  return NextResponse.json({ person: merged, signedBillsReassigned: signedResult.count, paidBillsReassigned: paidResult.count })
}
