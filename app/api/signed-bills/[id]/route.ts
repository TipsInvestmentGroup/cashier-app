import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, JWTPayload } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, addDays } from 'date-fns'

// Prisma client types for DayClosure are generated on deploy; assert to avoid local type drift.
const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

const SUPERUSER_EMAIL = 'johnonecmo@gmail.com'
const EXTENDED_WINDOW_EMAIL = 'r.mlay@tips.co.tz'

/** Access policy for editing/deleting a Signed Bill:
 *  - johnonecmo@gmail.com: full access, always.
 *  - Cashier: only while the bill's business day is still open (not closed) for its outlet,
 *    and only for their own outlet.
 *  - r.mlay@tips.co.tz: same as cashier, plus a 1-day grace period after the day closes.
 *  - Everyone else: no access. */
async function checkAccess(user: JWTPayload, bill: { outletId: string; date: Date }): Promise<string | null> {
  if (user.email === SUPERUSER_EMAIL) return null

  const isCashier = user.role === 'CASHIER'
  const isExtended = user.email === EXTENDED_WINDOW_EMAIL
  if (!isCashier && !isExtended) return 'You are not authorized to edit or delete signed bills'

  if (isCashier && user.outletId && bill.outletId !== user.outletId) {
    return 'You can only edit or delete bills from your own outlet'
  }

  const closure = await db.dayClosure.findUnique({
    where: { outletId_date: { outletId: bill.outletId, date: startOfDay(bill.date) } },
    select: { date: true },
  })
  if (!closure) return null // day still open — everyone in this bracket may act

  if (isExtended) {
    const graceEnd = endOfDay(addDays(startOfDay(closure.date), 1))
    if (new Date() <= graceEnd) return null
    return 'The 1-day edit window after closing has expired'
  }

  return 'This day has been closed. Ask a supervisor to reopen it before editing or deleting.'
}

/** Edit a signed bill's core fields. Line items are not editable here. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.signedBill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

  const denied = await checkAccess(user, existing)
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

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

  const { id } = await params
  const existing = await prisma.signedBill.findUnique({ where: { id }, include: { payments: true } })
  if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

  const denied = await checkAccess(user, existing)
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

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
