import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, JWTPayload } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay } from 'date-fns'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { getSignedBillsBlockedEmails } from '@/lib/approvals'
import { reverseJournalEntry, type Db } from '@/lib/ledger'
import { postCreditSale } from '@/lib/finance-ar'
import { resolveCreditTags } from '@/lib/credit-config'
import { syncCreditForBill, syncCreditForAccount, syncCreditForPerson } from '@/lib/credit-ledger'

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

/** Reverse a posted GL entry if it exists and isn't already reversed. The
 *  Finance Platform's rule is "never delete, only reverse" (see lib/ledger.ts),
 *  so a bill's credit-sale / write-off postings are reversed with an
 *  equal-and-opposite entry rather than by deleting the JournalEntry row. */
async function reverseIfPosted(tx: Db, journalEntryId: string | null | undefined, userId: string, reason: string): Promise<boolean> {
  if (!journalEntryId) return false
  const je = await tx.journalEntry.findUnique({ where: { id: journalEntryId }, select: { status: true } })
  if (!je || je.status === 'REVERSED') return false
  await reverseJournalEntry(tx, { journalEntryId, userId, reason })
  return true
}

/**
 * Edit a signed bill's core fields. Line items are not editable here.
 *
 * A posted bill's ledger must stay consistent with its data: this never edits a
 * posted JournalEntry in place (the "never edit, only reverse" rule). When a
 * GL-relevant field changes (amount / billType / date) the old credit-sale
 * entry is reversed and a fresh one is posted at the new values; when the
 * person changes, the bill's credit-account tag is re-resolved and both the old
 * and new credit ledgers are rebuilt. Non-financial edits (name spelling,
 * description, service staff, due date) touch neither the GL nor the subledger.
 */
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

  const newBillType = billType || existing.billType
  const newPersonId = personId || null
  const newDate = date ? new Date(date) : existing.date

  // Which changes require the ledger / credit subledger to be rebuilt?
  const glChanged = finalAmount !== existing.amount || newBillType !== existing.billType || newDate.getTime() !== existing.date.getTime()
  const personChanged = newPersonId !== existing.personId

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const reason = `Signed bill ${id} edited`

      // Re-resolve the credit-account tag for the (possibly new) person + type,
      // so the credit subledger attributes this bill to the right account.
      const tags = await resolveCreditTags(tx, { billType: newBillType, personId: newPersonId, outletId: existing.outletId })

      // If a GL-relevant field changed and the bill was posted, reverse the old
      // credit-sale entry and clear the link so it can be re-posted fresh.
      let reversed = false
      if (glChanged && existing.journalEntryId) {
        reversed = await reverseIfPosted(tx, existing.journalEntryId, user.userId, reason)
      }

      const row = await tx.signedBill.update({
        where: { id },
        data: {
          billType: newBillType,
          personId: newPersonId,
          personName,
          amount: finalAmount,
          serviceStaff,
          description,
          dueDate: dueDate ? new Date(dueDate) : null,
          date: newDate,
          creditGroupId: tags.creditGroupId,
          creditAccountId: tags.creditAccountId,
          ...(reversed ? { journalEntryId: null } : {}),
        },
        include: { outlet: true, person: true },
      })

      // Re-post the credit sale at the new values when we reversed the old one,
      // or when the bill was never posted but a GL-relevant field changed (it
      // may now qualify). Idempotent + type/approval-gated inside postCreditSale.
      if (reversed || (glChanged && !existing.journalEntryId)) {
        await postCreditSale(tx, {
          id: row.id,
          billType: row.billType,
          approvalStatus: row.approvalStatus,
          amount: row.amount,
          outletId: row.outletId,
          journalEntryId: null,
          date: row.date,
        }, user.userId)
      }

      // Rebuild the credit ledger for the bill's current account/person, and —
      // if attribution moved — for the account/person it left behind.
      await syncCreditForBill(tx, id)
      if (personChanged) {
        if (existing.creditAccountId && existing.creditAccountId !== tags.creditAccountId) await syncCreditForAccount(tx, existing.creditAccountId)
        if (existing.personId) await syncCreditForPerson(tx, existing.personId)
      }

      await tx.auditLog.create({
        data: {
          userId: user.userId, action: 'UPDATE', entity: 'SignedBill', entityId: id,
          details: JSON.stringify({
            editedBy: user.name,
            person: personName,
            glReposted: reversed || (glChanged && !existing.journalEntryId),
            changed: { amount: finalAmount !== existing.amount, billType: newBillType !== existing.billType, date: newDate.getTime() !== existing.date.getTime(), person: personChanged },
            from: { amount: existing.amount, billType: existing.billType, personId: existing.personId },
          }),
        },
      })

      return row
    }, { timeout: 20000 })

    return NextResponse.json(updated)
  } catch (e) {
    // A reversal / re-post post-dates to today, so a locked *current* financial
    // period rejects it and rolls the whole edit back. Surface the message so
    // the user knows to reopen that period rather than seeing a generic 500.
    const message = e instanceof Error ? e.message : 'Failed to edit bill'
    return NextResponse.json({ error: message }, { status: 409 })
  }
}

/** Delete a signed bill. Blocked once any payment has been recorded against it.
 *  Every GL posting the bill made (its credit sale, plus any write-offs) is
 *  reversed — never deleted — and the affected credit ledger is rebuilt, so the
 *  books and the receivable subledger stay consistent. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.signedBill.findUnique({ where: { id }, include: { payments: true, writeOffs: true } })
  if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

  const denied = await checkAccess(user, existing, 'delete')
  if (denied) return NextResponse.json({ error: denied }, { status: 403 })

  if (existing.payments.length > 0) {
    return NextResponse.json({ error: 'Cannot delete a bill that already has payments recorded against it' }, { status: 409 })
  }

  try {
    const summary = await prisma.$transaction(async (tx) => {
      const reason = `Signed bill ${id} deleted`
      let reversedEntries = 0

      // Reverse GL first (never delete a JournalEntry): the bill's write-offs,
      // then its own credit-sale entry.
      for (const w of existing.writeOffs) if (await reverseIfPosted(tx, w.journalEntryId, user.userId, reason)) reversedEntries++
      if (await reverseIfPosted(tx, existing.journalEntryId, user.userId, reason)) reversedEntries++

      // Write-offs have no DB cascade on their FK, so clear them explicitly.
      if (existing.writeOffs.length) await tx.signedBillWriteOff.deleteMany({ where: { signedBillId: id } })
      // BillItem rows cascade automatically (onDelete: Cascade in schema).
      await tx.signedBill.delete({ where: { id } })

      // Rebuild the credit ledger for the account/person that lost this bill.
      if (existing.creditAccountId) await syncCreditForAccount(tx, existing.creditAccountId)
      else if (existing.personId) await syncCreditForPerson(tx, existing.personId)

      await tx.auditLog.create({
        data: {
          userId: user.userId, action: 'DELETE', entity: 'SignedBill', entityId: id,
          details: JSON.stringify({
            deletedBy: user.name,
            snapshot: { personName: existing.personName, personId: existing.personId, billType: existing.billType, amount: existing.amount, outletId: existing.outletId, date: existing.date.toISOString() },
            reversedJournalEntries: reversedEntries, writeOffsCleared: existing.writeOffs.length,
          }),
        },
      })

      return { reversedEntries, writeOffsCleared: existing.writeOffs.length }
    }, { timeout: 20000 })

    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to delete bill'
    return NextResponse.json({ error: message }, { status: 409 })
  }
}
