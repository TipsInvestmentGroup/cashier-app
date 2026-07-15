import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']

/** Record a partial or full payment against an excess item, from either source. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const source = body.source === 'COLLECTION' ? 'COLLECTION' : body.source === 'CASH_RECON' ? 'CASH_RECON' : null
  const amount = roundMoney(body.amount)
  if (!source) return NextResponse.json({ error: 'source must be CASH_RECON or COLLECTION' }, { status: 400 })
  if (amount <= 0) return NextResponse.json({ error: 'Payment amount must be greater than zero' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (source === 'CASH_RECON' ? prisma.cashReconExcess : prisma.collectionExcess) as any
  const existing = await model.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Excess item not found' }, { status: 404 })

  const balance = roundMoney(existing.amount - existing.paidAmount)
  if (amount > balance) {
    return NextResponse.json({ error: `Payment ${amount} exceeds the remaining balance of ${balance}` }, { status: 400 })
  }

  const newPaid = roundMoney(existing.paidAmount + amount)
  const updated = await model.update({ where: { id }, data: { paidAmount: newPaid } })

  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'UPDATE',
      entity: source === 'CASH_RECON' ? 'CashReconExcess' : 'CollectionExcess', entityId: id,
      details: `Excess payment ${amount} recorded (paid ${newPaid} of ${existing.amount})`,
    },
  })

  return NextResponse.json({ ...updated, balance: roundMoney(updated.amount - updated.paidAmount) })
}
