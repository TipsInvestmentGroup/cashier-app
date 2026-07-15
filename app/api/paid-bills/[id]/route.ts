import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { roundMoney } from '@/lib/utils'

/** Recompute a signed bill's status from the sum of its paid-bill rows (mirrors lib/payment-alloc.ts). */
async function recomputeBillStatus(signedBillId: string) {
  const bill = await prisma.signedBill.findUnique({ where: { id: signedBillId } })
  if (!bill) return
  const agg = await prisma.paidBill.aggregate({ where: { signedBillId }, _sum: { amountPaid: true } })
  const tot = agg._sum.amountPaid || 0
  await prisma.signedBill.update({ where: { id: signedBillId }, data: { status: tot >= bill.amount ? 'PAID' : tot > 0 ? 'PARTIAL' : 'UNPAID' } })
}

/** Edit a paid-bill record. The signedBillId link itself is not changeable here. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPermission(user.email, user.userId, RESOURCES.PAID_BILLS, 'edit'))) {
    return NextResponse.json({ error: 'You are not authorized to edit paid bills' }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.paidBill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.date !== undefined) data.date = new Date(body.date)
  if (body.payerName !== undefined) data.payerName = body.payerName
  if (body.payerCategory !== undefined) data.payerCategory = body.payerCategory || null
  if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod
  if (body.notes !== undefined) data.notes = body.notes || null
  if (body.billRef !== undefined) data.billRef = body.billRef || null
  if (body.outletId !== undefined) data.outletId = body.outletId
  if (body.amountPaid !== undefined) {
    const amt = roundMoney(body.amountPaid)
    if (!amt || amt <= 0) return NextResponse.json({ error: 'Amount must be > 0' }, { status: 400 })
    data.amountPaid = amt
  }

  const updated = await prisma.paidBill.update({
    where: { id },
    data,
    include: { outlet: true, cashier: { select: { name: true } }, signedBill: true, person: true },
  })

  if (existing.signedBillId && body.amountPaid !== undefined) {
    await recomputeBillStatus(existing.signedBillId)
  }

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'PaidBill', entityId: id, details: `Edited payment for ${updated.payerName} by ${user.name}` },
  })

  return NextResponse.json(updated)
}

/** Delete a paid-bill record, then re-sync its linked signed bill's status. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPermission(user.email, user.userId, RESOURCES.PAID_BILLS, 'delete'))) {
    return NextResponse.json({ error: 'You are not authorized to delete paid bills' }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.paidBill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

  await prisma.paidBill.delete({ where: { id } })
  if (existing.signedBillId) await recomputeBillStatus(existing.signedBillId)

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'PaidBill', entityId: id, details: `Deleted payment for ${existing.payerName} by ${user.name}` },
  })

  return NextResponse.json({ ok: true })
}
