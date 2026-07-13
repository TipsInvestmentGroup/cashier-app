import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'

const CAN_WRITE = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']
// Roles allowed to edit/delete signed bills from ANY outlet; others are limited to their own.
const CROSS_OUTLET = ['ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** Edit a signed bill's core fields. Line items are not editable here. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_WRITE)) return NextResponse.json({ error: 'You are not authorized to edit signed bills' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.signedBill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  if (!CROSS_OUTLET.includes(user.role) && user.outletId && existing.outletId !== user.outletId) {
    return NextResponse.json({ error: 'You can only edit bills from your own outlet' }, { status: 403 })
  }

  const body = await req.json()
  const { billType, personId, personName, amount, serviceStaff, description, dueDate, date } = body
  if (!personName) return NextResponse.json({ error: 'Person name is required' }, { status: 400 })
  const finalAmount = roundMoney(Number(amount))
  if (!finalAmount || finalAmount <= 0) return NextResponse.json({ error: 'Amount must be > 0' }, { status: 400 })

  const updated = await prisma.signedBill.update({
    where: { id },
    data: {
      billType: billType || existing.billType,
      personId: personId || null,
      personName,
      amount: finalAmount,
      serviceStaff,
      description,
      dueDate: dueDate ? new Date(dueDate) : null,
      date: date ? new Date(date) : existing.date,
    },
    include: { outlet: true, person: true },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'SignedBill', entityId: id, details: `Edited signed bill for ${personName} by ${user.name}` },
  })

  return NextResponse.json(updated)
}

/** Delete a signed bill. Blocked once any payment has been recorded against it. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_WRITE)) return NextResponse.json({ error: 'You are not authorized to delete signed bills' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.signedBill.findUnique({ where: { id }, include: { payments: true } })
  if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  if (!CROSS_OUTLET.includes(user.role) && user.outletId && existing.outletId !== user.outletId) {
    return NextResponse.json({ error: 'You can only delete bills from your own outlet' }, { status: 403 })
  }
  if (existing.payments.length > 0) {
    return NextResponse.json({ error: 'Cannot delete a bill that already has payments recorded against it' }, { status: 409 })
  }

  // BillItem rows cascade automatically (onDelete: Cascade in schema).
  await prisma.signedBill.delete({ where: { id } })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'SignedBill', entityId: id, details: `Deleted signed bill for ${existing.personName} by ${user.name}` },
  })

  return NextResponse.json({ ok: true })
}
