import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED', 'BLACKLISTED']

/** PATCH — edit a credit account's override / status / risk rating. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.creditAccount.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.creditLimitOverride !== undefined) {
    // Empty / 0 / null clears the override → falls back to group / person limit.
    const n = Number(body.creditLimitOverride)
    data.creditLimitOverride = body.creditLimitOverride === null || body.creditLimitOverride === '' || !(n > 0) ? null : n
  }
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return NextResponse.json({ error: `status must be one of ${STATUSES.join(', ')}` }, { status: 400 })
    data.status = body.status
  }
  if (body.riskRating !== undefined) data.riskRating = String(body.riskRating)

  const account = await prisma.creditAccount.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'CreditAccount', entityId: id, details: `Updated credit account ${account.displayName}` },
  })
  return NextResponse.json(account)
}
