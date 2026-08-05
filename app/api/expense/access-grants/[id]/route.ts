import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { revokeGrant } from '@/lib/expense-grants'

/**
 * DELETE — revoke an access grant. Never a hard delete (§4): the row stays so a
 * historical request can still show that the person who approved or paid it did
 * hold the grant at the time. Revoking is idempotent — a second call leaves the
 * original revokedAt intact rather than restamping it.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const grant = await prisma.expenseAccessGrant.findUnique({ where: { id } })
  if (!grant) return NextResponse.json({ error: 'Access grant not found' }, { status: 404 })

  const revoked = await revokeGrant(id, user.userId)

  const target = await prisma.user.findUnique({ where: { id: grant.userId }, select: { name: true } })
  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'DELETE', entity: 'ExpenseAccessGrant', entityId: id,
      details: `Revoked ${grant.grantType}${grant.fundClass ? `:${grant.fundClass}` : ''} from ${target?.name || grant.userId}`,
    },
  })
  return NextResponse.json(revoked)
}
