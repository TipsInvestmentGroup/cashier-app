import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { roundMoney } from '@/lib/utils'
import { reverseJournalEntry, type Db } from '@/lib/ledger'
import { postReceipt } from '@/lib/finance-ar'
import { syncCreditForBill, syncCreditForPerson } from '@/lib/credit-ledger'

/** Recompute a signed bill's payment status from the sum of its paid-bill rows. */
async function recomputeBillStatus(tx: Db, signedBillId: string) {
  const bill = await tx.signedBill.findUnique({ where: { id: signedBillId } })
  if (!bill) return
  const agg = await tx.paidBill.aggregate({ where: { signedBillId }, _sum: { amountPaid: true } })
  const tot = agg._sum.amountPaid || 0
  await tx.signedBill.update({ where: { id: signedBillId }, data: { status: tot >= bill.amount ? 'PAID' : tot > 0 ? 'PARTIAL' : 'UNPAID' } })
}

/** Reverse every GL entry a receipt produced (its cash posting, plus any
 *  deposit-application entry) — never delete a JournalEntry. Returns the count. */
async function reverseReceiptEntries(tx: Db, paidBillId: string, userId: string, reason: string): Promise<number> {
  const jes = await tx.journalEntry.findMany({ where: { sourceType: 'PaidBill', sourceId: paidBillId, status: { not: 'REVERSED' } }, select: { id: true } })
  for (const je of jes) await reverseJournalEntry(tx, { journalEntryId: je.id, userId, reason })
  return jes.length
}

/** Re-sync the credit subledger for a receipt's linked bill (or its payer). */
async function resyncCredit(tx: Db, existing: { signedBillId: string | null; personId: string | null }) {
  if (existing.signedBillId) await syncCreditForBill(tx, existing.signedBillId)
  else await syncCreditForPerson(tx, existing.personId)
}

/** Edit a paid-bill record. The signedBillId link itself is not changeable here.
 *  A change to a GL-relevant field (amount / method / date) reverses the old
 *  posting and re-posts fresh so the ledger keeps matching the receipt. */
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

  const amountChanged = body.amountPaid !== undefined && roundMoney(body.amountPaid) !== existing.amountPaid
  const methodChanged = body.paymentMethod !== undefined && body.paymentMethod !== existing.paymentMethod
  const dateChanged = body.date !== undefined && new Date(body.date).getTime() !== existing.date.getTime()
  const glChanged = amountChanged || methodChanged || dateChanged

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (glChanged) await reverseReceiptEntries(tx, id, user.userId, `Payment ${id} edited`)

      const row = await tx.paidBill.update({
        where: { id },
        data: { ...data, ...(glChanged ? { journalEntryId: null } : {}) },
        include: { outlet: true, cashier: { select: { name: true } }, signedBill: true, person: true },
      })

      if (glChanged) await postReceipt(tx, row, user.userId) // re-post at the new amount/method/date
      if (existing.signedBillId && amountChanged) await recomputeBillStatus(tx, existing.signedBillId)
      if (glChanged) await resyncCredit(tx, existing)

      await tx.auditLog.create({
        data: { userId: user.userId, action: 'UPDATE', entity: 'PaidBill', entityId: id, details: `Edited payment for ${row.payerName} by ${user.name}${glChanged ? ' (GL re-posted)' : ''}` },
      })
      return row
    }, { timeout: 20000 })

    return NextResponse.json(updated)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to edit payment'
    return NextResponse.json({ error: message }, { status: 409 })
  }
}

/** Delete a paid-bill record: reverse its GL postings, remove it, then re-sync
 *  the linked signed bill's status and the credit subledger. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPermission(user.email, user.userId, RESOURCES.PAID_BILLS, 'delete'))) {
    return NextResponse.json({ error: 'You are not authorized to delete paid bills' }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.paidBill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

  try {
    await prisma.$transaction(async (tx) => {
      const reversed = await reverseReceiptEntries(tx, id, user.userId, `Payment ${id} deleted`)
      await tx.paidBill.delete({ where: { id } })
      if (existing.signedBillId) await recomputeBillStatus(tx, existing.signedBillId)
      await resyncCredit(tx, existing)
      await tx.auditLog.create({
        data: { userId: user.userId, action: 'DELETE', entity: 'PaidBill', entityId: id, details: JSON.stringify({ deletedBy: user.name, payerName: existing.payerName, amountPaid: existing.amountPaid, signedBillId: existing.signedBillId, reversedJournalEntries: reversed }) },
      })
    }, { timeout: 20000 })

    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to delete payment'
    return NextResponse.json({ error: message }, { status: 409 })
  }
}
