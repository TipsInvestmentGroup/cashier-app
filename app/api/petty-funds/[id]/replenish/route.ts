import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageFunds } from '@/lib/petty-access'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** Top up (or adjust) an accountant fund. body: { amount, note?, type? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageFunds(user.role)) return NextResponse.json({ error: 'Only an accountant or admin can replenish a fund' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const amount = roundMoney(body.amount)
  // ADJUST may be negative; REPLENISH must be positive.
  const type = String(body.type || 'REPLENISH').toUpperCase() === 'ADJUST' ? 'ADJUST' : 'REPLENISH'
  if (!amount || (type === 'REPLENISH' && amount <= 0)) return NextResponse.json({ error: 'Enter a valid amount' }, { status: 400 })

  const fund = await db.pettyFund.findUnique({ where: { id } })
  if (!fund) return NextResponse.json({ error: 'Fund not found' }, { status: 404 })

  const txn = await db.pettyFundTxn.create({
    data: { fundId: id, type, amount, note: body.note || null, createdById: user.userId, createdByName: user.name },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: type, entity: 'PettyFund', entityId: id, details: `${type} ${amount}${body.note ? ` — ${body.note}` : ''}` },
  })

  return NextResponse.json(txn, { status: 201 })
}
