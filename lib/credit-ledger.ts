// Credit ledger (Phase 4) — builds the CreditTransaction projection and the
// materialized CreditAccount.currentBalance from the authoritative SignedBill /
// PaidBill / SignedBillWriteOff A/R. The A/R stays the source of truth; this is
// a DERIVED, rebuildable view, so a full reconcile always reproduces it exactly
// and it can never permanently drift.
//
// Balance definition (per account) = Σ(real invoices) − Σ(payments) − Σ(write-offs):
//   • "real" invoice = a SignedBill that counts as debt per approvalGate()
//     (APPROVED, or a non-request type) — a pending/rejected request contributes
//     nothing, matching what postCreditSale() posts to the GL.
//   • Attribution is by creditAccountId (the framework tag stamped at creation
//     in Phase 2 and backfilled onto historical bills), plus unlinked person
//     credits (advances) for the account's person.
//   • Includes internal markers like STAFF_LOSS (owed by staff) so the balance
//     is "total owed"; each row snapshots isCreditBearing so reports can still
//     separate trade receivable from internal markers.
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'
import { REQUEST_BILL_TYPES } from '@/lib/bill-types'

// A bill is real debt when approved, or when it isn't a request type. Mirrors
// approvalGate() in lib/bill-types.ts and postCreditSale()'s posting gate.
function billIsReal(b: { billType: string; approvalStatus: string }): boolean {
  return b.approvalStatus === 'APPROVED' || !(REQUEST_BILL_TYPES as readonly string[]).includes(b.billType)
}

interface LedgerRow {
  txnType: 'INVOICE' | 'PAYMENT' | 'WRITEOFF'
  signedAmount: number
  billType: string | null
  isCreditBearing: boolean
  sourceType: 'SignedBill' | 'PaidBill' | 'SignedBillWriteOff'
  sourceId: string
  entryDate: Date
}

// Map billType → isCreditBearing from the configured groups (fallback: anything
// that isn't STAFF_LOSS is credit-bearing — the pre-framework rule).
async function creditBearingMap(db: Db, companyId: string | null): Promise<Map<string, boolean>> {
  const m = new Map<string, boolean>()
  if (!companyId) return m
  const groups = await db.creditGroup.findMany({ where: { companyId }, select: { legacyBillTypeCode: true, isCreditBearing: true } })
  for (const g of groups) if (g.legacyBillTypeCode) m.set(g.legacyBillTypeCode, g.isCreditBearing)
  return m
}
function isBearing(m: Map<string, boolean>, billType: string | null): boolean {
  if (!billType) return true
  const v = m.get(billType)
  return v === undefined ? billType !== 'STAFF_LOSS' : v
}

/**
 * Collect the ledger rows for one account from its A/R. Attribution is by
 * creditAccountId; payments also include the account person's unlinked credits.
 */
async function collectLedgerRows(db: Db, account: { id: string; personId: string | null; companyId: string }): Promise<LedgerRow[]> {
  const cb = await creditBearingMap(db, account.companyId)

  const bills = await db.signedBill.findMany({
    where: { creditAccountId: account.id },
    select: { id: true, amount: true, billType: true, approvalStatus: true, date: true },
  })
  const realBills = bills.filter(billIsReal)

  // Payments: those settling one of this account's bills, plus the person's
  // unlinked credits (advances). Filter to payments whose linked bill is real.
  const payWhere = account.personId
    ? { OR: [{ signedBill: { creditAccountId: account.id } }, { signedBillId: null, personId: account.personId }] }
    : { signedBill: { creditAccountId: account.id } }
  const payments = await db.paidBill.findMany({
    where: payWhere,
    select: { id: true, amountPaid: true, date: true, signedBillId: true, signedBill: { select: { billType: true, approvalStatus: true } } },
  })
  const realPayments = payments.filter((p: { signedBillId: string | null; signedBill: { billType: string; approvalStatus: string } | null }) => !p.signedBillId || (p.signedBill && billIsReal(p.signedBill)))

  const writeoffs = await db.signedBillWriteOff.findMany({
    where: { signedBill: { creditAccountId: account.id } },
    select: { id: true, amount: true, createdAt: true, signedBill: { select: { billType: true, approvalStatus: true } } },
  })
  const realWriteoffs = writeoffs.filter((w: { signedBill: { billType: string; approvalStatus: string } | null }) => w.signedBill && billIsReal(w.signedBill))

  const rows: LedgerRow[] = []
  for (const b of realBills) rows.push({ txnType: 'INVOICE', signedAmount: roundMoney(b.amount), billType: b.billType, isCreditBearing: isBearing(cb, b.billType), sourceType: 'SignedBill', sourceId: b.id, entryDate: b.date })
  for (const p of realPayments) rows.push({ txnType: 'PAYMENT', signedAmount: -roundMoney(p.amountPaid), billType: p.signedBill?.billType ?? null, isCreditBearing: isBearing(cb, p.signedBill?.billType ?? null), sourceType: 'PaidBill', sourceId: p.id, entryDate: p.date })
  for (const w of realWriteoffs) rows.push({ txnType: 'WRITEOFF', signedAmount: -roundMoney(w.amount), billType: w.signedBill?.billType ?? null, isCreditBearing: isBearing(cb, w.signedBill?.billType ?? null), sourceType: 'SignedBillWriteOff', sourceId: w.id, entryDate: w.createdAt })
  return rows
}

/**
 * Rebuild one account's ledger rows AND its currentBalance from source
 * (delete-then-recreate). Idempotent and drift-proof. Returns the new balance.
 * Runs on the passed db (client or tx) — no nested transaction, so it composes
 * inside a caller's transaction; standalone the writes are near-atomic per row set.
 */
export async function rebuildAccountLedger(db: Db, accountId: string): Promise<{ balance: number; rows: number } | null> {
  const account = await db.creditAccount.findUnique({ where: { id: accountId }, select: { id: true, personId: true, companyId: true, currency: true } })
  if (!account) return null

  const rows = await collectLedgerRows(db, account)
  const balance = roundMoney(rows.reduce((s, r) => s + r.signedAmount, 0))

  await db.creditTransaction.deleteMany({ where: { accountId } })
  if (rows.length) {
    await db.creditTransaction.createMany({ data: rows.map((r) => ({ ...r, accountId, currency: account.currency })) })
  }
  await db.creditAccount.update({ where: { id: accountId }, data: { currentBalance: balance, balanceVersion: { increment: 1 } } })
  return { balance, rows: rows.length }
}

/** Sync by account id — best-effort (no-op if the id doesn't resolve). Never
 *  throws for a missing account, so it's safe to call from write paths. */
export async function syncCreditForAccount(db: Db, accountId: string | null | undefined): Promise<void> {
  if (!accountId) return
  await rebuildAccountLedger(db, accountId)
}

/** Sync by person — resolves the 1:1 account, then rebuilds. No-op if the
 *  person has no credit account (e.g. name-only bills). */
export async function syncCreditForPerson(db: Db, personId: string | null | undefined): Promise<void> {
  if (!personId) return
  const account = await db.creditAccount.findUnique({ where: { personId }, select: { id: true } })
  if (account) await rebuildAccountLedger(db, account.id)
}

/** Sync the account behind a SignedBill (by its creditAccountId tag, else its
 *  person). Best-effort — the universal hook for any bill create/approve/change. */
export async function syncCreditForBill(db: Db, billId: string | null | undefined): Promise<void> {
  if (!billId) return
  const bill = await db.signedBill.findUnique({ where: { id: billId }, select: { creditAccountId: true, personId: true } })
  if (!bill) return
  if (bill.creditAccountId) await syncCreditForAccount(db, bill.creditAccountId)
  else if (bill.personId) await syncCreditForPerson(db, bill.personId)
}

/**
 * Full reconcile — rebuild every account's ledger + balance from source. The
 * authority: run on a schedule and after bulk changes; drift-proof by
 * construction. Returns totals for reporting/self-diagnostic.
 */
export async function reconcileAllCreditLedgers(db: Db): Promise<{ accounts: number; totalOutstanding: number; nonZero: number }> {
  const accounts = await db.creditAccount.findMany({ select: { id: true } })
  let total = 0
  let sum = 0
  let nonZero = 0
  for (const a of accounts) {
    const res = await rebuildAccountLedger(db, a.id)
    if (res) { total++; sum = roundMoney(sum + res.balance); if (res.balance !== 0) nonZero++ }
  }
  return { accounts: total, totalOutstanding: sum, nonZero }
}
