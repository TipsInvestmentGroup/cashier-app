// GL posting for auto STAFF_LOSS signed bills.
//
// A staff loss is the shortfall between system sales and what staff actually
// collected/handed over — revenue the business earned but hasn't received, now
// owed by the staff member and recovered from pay. So it belongs on the books
// as Dr Accounts Receivable / Cr Sales Revenue at the bill's gross amount. It
// uses the SAME 1300 A/R that payroll credits when it recovers the loss (see
// lib/payroll-run.ts's STAFF_PURCHASES recovery), so creation and recovery net
// to zero without a dedicated account. A cash settlement draws it down through
// the ordinary receipt path (lib/finance-ar.ts postReceipt keys off the bill's
// journalEntryId, which this sets).
//
// STAFF_LOSS never flows through postCreditSale (it isn't a credit-limit bill
// type), so this is its dedicated posting path.
import { postJournalEntry, reverseJournalEntry, type Db } from './ledger'
import { resolveAccountId, resolveDefaultCompanyId } from './finance-mapping'
import { roundMoney } from './utils'

/**
 * Reconcile the GL with one STAFF_LOSS bill's current state. Idempotent and
 * self-correcting across the auto-loss recompute lifecycle (the amount is
 * recomputed, and the bill deleted, as a collection is edited): posts on first
 * sight, reverses+reposts when the gross amount changes, and reverses when the
 * bill is gone or written off — never edits a posted entry (audit-safe).
 *
 * Safe to call from any staff-loss mutation site, even more than once: a call
 * where the GL already matches the bill is a no-op.
 */
export async function syncStaffLossReceivable(db: Db, billId: string): Promise<void> {
  const bill = await db.signedBill.findUnique({
    where: { id: billId },
    select: { id: true, billType: true, amount: true, status: true, outletId: true, date: true, cashierId: true, journalEntryId: true },
  })
  const desired = bill && bill.billType === 'STAFF_LOSS' && bill.status !== 'WRITTEN_OFF'
    ? roundMoney(bill.amount)
    : 0

  // The current original posting for this bill, if any — a reversal entry
  // (reversalOfId set) carries the same sourceType/sourceId and must be ignored.
  const existing = await db.journalEntry.findFirst({
    where: { sourceModule: 'SALES', sourceType: 'StaffLoss', sourceId: billId, status: { not: 'REVERSED' }, reversalOfId: null },
    include: { lines: true },
  })
  const existingAmount = existing
    ? roundMoney((existing.lines as { debit: number | null }[]).reduce((s, l) => s + (l.debit || 0), 0))
    : 0

  if (roundMoney(desired) === existingAmount) return // already in sync (covers both 0)

  const userId = bill?.cashierId || 'system'
  if (existing) {
    await reverseJournalEntry(db, { journalEntryId: existing.id, userId, reason: 'Staff loss recomputed' })
    if (bill?.journalEntryId === existing.id) await db.signedBill.update({ where: { id: billId }, data: { journalEntryId: null } })
  }

  if (desired > 0 && bill) {
    const outlet = await db.outlet.findUnique({ where: { id: bill.outletId }, select: { companyId: true } })
    const companyId = outlet?.companyId || (await resolveDefaultCompanyId(db))
    if (!companyId) return
    const [arId, revId] = await Promise.all([
      resolveAccountId(db, { companyId, key: 'ACCOUNTS_RECEIVABLE' }),
      resolveAccountId(db, { companyId, key: 'SALES_REVENUE' }),
    ])
    const { id: journalEntryId } = await postJournalEntry(db, {
      companyId, entryDate: bill.date, sourceModule: 'SALES', sourceType: 'StaffLoss', sourceId: billId,
      description: 'Staff loss receivable', createdById: userId,
      lines: [
        { accountId: arId, debit: desired, outletId: bill.outletId, description: 'Staff loss (owed by staff)' },
        { accountId: revId, credit: desired, outletId: bill.outletId, description: 'Uncollected sales' },
      ],
    })
    await db.signedBill.update({ where: { id: billId }, data: { journalEntryId } })
  }
}
