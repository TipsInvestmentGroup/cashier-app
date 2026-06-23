import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canDisbursePetty } from '@/lib/petty-access'
import { roundMoney } from '@/lib/utils'

// New petty-cash models/fields aren't in the stale local Prisma client yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * Process payment for an APPROVED petty-cash request.
 * body: { pettyType: 'CASHIER'|'ACCOUNTANT', method, payerName?, paidAt?, receiptUrl?, fundId? }
 * - CASHIER: paid from the outlet's daily cash drawer (flows into cash recon).
 * - ACCOUNTANT: drawn down from an allocated PettyFund (must have balance).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canDisbursePetty(user.role)) return NextResponse.json({ error: 'You are not authorized to disburse petty cash' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const pettyType = String(body.pettyType || 'CASHIER').toUpperCase() === 'ACCOUNTANT' ? 'ACCOUNTANT' : 'CASHIER'
  const method = String(body.method || 'CASH').toUpperCase()

  const existing = await db.pettyCash.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (existing.status !== 'APPROVED') return NextResponse.json({ error: 'Only approved requests can be paid' }, { status: 400 })
  if (existing.paymentStatus === 'PAID') return NextResponse.json({ error: 'This request has already been paid' }, { status: 409 })

  const amount = roundMoney(existing.amount)

  // Accountant fund: validate balance and draw it down atomically with the payment.
  let fundId: string | null = null
  if (pettyType === 'ACCOUNTANT') {
    fundId = String(body.fundId || '')
    if (!fundId) return NextResponse.json({ error: 'Select an accountant fund to pay from' }, { status: 400 })
    const fund = await db.pettyFund.findUnique({ where: { id: fundId } })
    if (!fund || !fund.isActive) return NextResponse.json({ error: 'Fund not found or inactive' }, { status: 404 })
    const agg = await db.pettyFundTxn.aggregate({ where: { fundId }, _sum: { amount: true } })
    const balance = roundMoney((fund.openingBalance || 0) + (agg._sum.amount || 0))
    if (balance < amount) return NextResponse.json({ error: `Insufficient fund balance (${balance.toLocaleString()} available, ${amount.toLocaleString()} needed)` }, { status: 400 })
  }

  const paidAt = body.paidAt ? new Date(body.paidAt) : new Date()

  const updated = await db.$transaction(async (tx: typeof db) => {
    const pc = await tx.pettyCash.update({
      where: { id },
      data: {
        paymentStatus: 'PAID',
        pettyType,
        fundId,
        paymentMethod: method,
        paidAt,
        paidById: user.userId,
        paidByName: body.payerName || user.name,
        receiptUrl: body.receiptUrl || existing.receiptUrl || null,
        payeeAccount: body.payeeAccount ?? existing.payeeAccount,
      },
      include: { items: true },
    })
    if (pettyType === 'ACCOUNTANT' && fundId) {
      await tx.pettyFundTxn.create({
        data: {
          fundId, type: 'PAYMENT', amount: -amount, pettyCashId: id,
          note: `Payment: ${existing.purpose}`, createdById: user.userId, createdByName: user.name,
        },
      })
    }
    return pc
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'PAY', entity: 'PettyCash', entityId: id, details: `Paid ${amount} via ${method} from ${pettyType === 'ACCOUNTANT' ? 'accountant fund' : 'cashier drawer'}` },
  })

  return NextResponse.json(updated)
}
