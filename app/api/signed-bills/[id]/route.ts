import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, JWTPayload } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay } from 'date-fns'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { getSignedBillsBlockedEmails } from '@/lib/approvals'

// Prisma client types for DayClosure are generated on deploy; assert to avoid local type drift.
const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

/** Access policy for editing/deleting a Signed Bill:
 *  - The system owner: full access, always.
 *  - Cashier: only while the bill's business day is still open (not closed) for its outlet,
 *    and only for their own outlet.
 *  - Configured blocked emails (see lib/approvals.ts): explicitly denied regardless of role.
 *  - Everyone else: no access. */
async function checkAccess(user: JWTPayload, bill: { outletId: string; date: Date }, action: 'edit' | 'delete'): Promise<string | null> {
  if (!!OWNER_EMAIL && (user.email || '').toLowerCase() === OWNER_EMAIL) return null
  if (await hasPermission(user.email, user.userId, RESOURCES.SIGNED_BILLS, action)) return null
  if ((await getSignedBillsBlockedEmails()).includes((user.email || '').toLowerCase())) return 'You are not authorized to edit or delete signed bills'

  const isCashier = user.role === 'CASHIER'
  if (!isCashier) return 'You are not authorized to edit or delete signed bills'

  if (user.outletId && bill.outletId !== user.outletId) {
    return 'You can only edit or delete bills from your own outlet'
  }

  const closure = await db.dayClosure.findUnique({
    where: { outletId_date: { outletId: bill.outletId, date: startOfDay(bill.date) } },
    select: { date: true },
  })
  if (!closure) return null // day still open — everyone in this bracket may act

  return 'This day has been closed. Ask a supervisor to reopen it before editing or deleting.'
}

/** Edit a signed bill's core fields. Line items are not editable here. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.signedBill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

  const denied = await checkAccess(user, existing, 'edit')
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

  const denied = await checkAccess(user, existing, 'delete')
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
