import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, readOutletScope, writeOutletId } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { generateBillReference } from '@/lib/bill-reference'

const CAN_WRITE = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** List recent Excess Refunds. Optionally filter by outlet. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_WRITE.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  // Cashiers are strictly locked to their own outlet.
  const outletId = readOutletScope(user, searchParams.get('outletId'))

  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId

  const items = await prisma.excessRefund.findMany({
    where,
    include: {
      outlet: true,
      person: true,
      refundedBy: { select: { name: true } },
    },
    orderBy: { date: 'desc' },
    take: 200,
  })

  return NextResponse.json(items)
}

/** Create an Excess Refund (EXR) — refunding a customer/person who overpaid. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_WRITE)) return NextResponse.json({ error: 'You are not authorized to create excess refunds' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { amount, personId, personName, reason, outletId, notes } = body

  const finalAmount = roundMoney(Number(amount))
  if (!(finalAmount > 0)) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 })
  if (!personName || !String(personName).trim()) return NextResponse.json({ error: 'Person name is required' }, { status: 400 })
  if (!['OVERPAYMENT', 'DUPLICATE_PAYMENT', 'OTHER'].includes(reason)) return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })

  const usedOutletId = writeOutletId(user, outletId)
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })

  const refund = await prisma.$transaction(async (tx) => {
    const recordId = crypto.randomUUID()
    const ref = await generateBillReference(tx, {
      recordId, sourceModel: 'ExcessRefund', billTypeCode: 'EXR', date: new Date(), personId: personId || null, outletId: usedOutletId,
    })

    const created = await tx.excessRefund.create({
      data: {
        id: recordId,
        internalBillId: ref.internalBillId,
        displayReference: ref.displayReference,
        billTypeConfigId: ref.billTypeConfigId,
        amount: finalAmount,
        personId: personId || null,
        personName: String(personName).trim(),
        reason,
        outletId: usedOutletId,
        refundedById: user.userId,
        approvalStatus: 'PENDING',
        notes: notes || null,
      },
      include: { outlet: true, person: true },
    })

    await tx.auditLog.create({
      data: {
        userId: user.userId,
        action: 'CREATE',
        entity: 'ExcessRefund',
        entityId: created.id,
        details: `Created excess refund ${ref.displayReference} of ${finalAmount} for ${created.personName}`,
      },
    })

    return created
  })

  return NextResponse.json(refund, { status: 201 })
}
