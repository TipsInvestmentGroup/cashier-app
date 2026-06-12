import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { allocatePayment } from '@/lib/payment-alloc'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId
  else if (user.outletId && !['ADMIN', 'DIRECTOR', 'MANAGER', 'ACCOUNTANT'].includes(user.role)) {
    where.outletId = user.outletId
  }
  if (startDate && endDate) {
    where.date = { gte: new Date(startDate), lte: new Date(endDate) }
  }

  const payments = await prisma.paidBill.findMany({
    where,
    include: {
      outlet: true,
      cashier: { select: { name: true } },
      signedBill: true,
      person: true,
    },
    orderBy: { date: 'desc' },
    take: 200,
  })

  return NextResponse.json(payments)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { signedBillId, personId, payerName, payerCategory, amountPaid, paymentMethod, notes, outletId, date, billRef } = body
  const selectedBillIds: string[] = Array.isArray(body.selectedBillIds) ? body.selectedBillIds : (signedBillId ? [signedBillId] : [])

  const usedOutletId = outletId || user.outletId
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })
  if (!payerName) return NextResponse.json({ error: 'Payer name required' }, { status: 400 })
  if (!amountPaid || Number(amountPaid) <= 0) return NextResponse.json({ error: 'Amount must be > 0' }, { status: 400 })

  // Allocate across the member's outstanding bills (selected first, then FIFO);
  // any leftover is recorded as an unlinked credit.
  const result = await allocatePayment({
    payerName, category: payerCategory || null, totalAmount: Number(amountPaid),
    selectedBillIds, paymentMethod: paymentMethod || 'CASH', outletId: usedOutletId,
    cashierId: user.userId, date: date ? new Date(date) : new Date(),
    billRef: billRef || null, notes: notes || null, personId: personId || null,
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'PaidBill', entityId: null, details: `Payment ${amountPaid} for ${payerName}: ${result.billsPaid} bill(s) settled${result.leftover > 0 ? `, ${result.leftover} credit` : ''}` },
  })

  return NextResponse.json({ ok: true, ...result }, { status: 201 })
}
