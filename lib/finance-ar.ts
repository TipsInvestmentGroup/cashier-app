// Accounts Receivable — Stage 2 of the Finance Platform. Deliberately built
// on top of the EXISTING SignedBill (credit sale) / PaidBill (receipt)
// models instead of a new "CustomerInvoice" model, so nothing is duplicated
// and every existing screen (Receivables, Customer Bills, Admin & Director
// Bills, Tips & DJ Bills, Daily Collections) keeps working unmodified — this
// file only adds GL posting on top of what those screens already write.
import { prisma } from './prisma'
import { roundMoney } from './utils'
import { postJournalEntry, type Db } from './ledger'
import { resolveAccountId, resolveChannelAccountId, resolveDefaultCompanyId } from './finance-mapping'
import { CREDIT_BILL_TYPES, REQUEST_BILL_TYPES } from './bill-types'
import { resolveEffectiveLimit, type LimitSource, type OverLimitBehavior, resolveCreditModuleConfig } from './credit-config'

async function resolveCompanyIdForOutlet(db: Db, outletId: string): Promise<string | null> {
  const outlet = await db.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
  return outlet?.companyId || (await resolveDefaultCompanyId(db))
}

interface SignedBillForPosting {
  id: string
  billType: string
  approvalStatus: string
  amount: number
  outletId: string
  journalEntryId: string | null
  date: Date
  createdById?: string
}

/**
 * Posts a credit sale's receivable — Dr Accounts Receivable / Cr Sales
 * Revenue — for one SignedBill, once it's "real" (see approvalGate() in
 * lib/bill-types.ts: non-request types count immediately; CUSTOMER/TIPS/DJ
 * only once approved). Idempotent (no-ops if journalEntryId is already
 * set) and silently no-ops for STAFF_LOSS or a not-yet-approved request
 * bill — callers can call this unconditionally at every creation/approval
 * site without branching on billType themselves.
 */
export async function postCreditSale(db: Db, bill: SignedBillForPosting, createdById: string): Promise<void> {
  if (bill.journalEntryId) return
  if (!CREDIT_BILL_TYPES.includes(bill.billType as (typeof CREDIT_BILL_TYPES)[number])) return
  if (REQUEST_BILL_TYPES.includes(bill.billType as (typeof REQUEST_BILL_TYPES)[number]) && bill.approvalStatus !== 'APPROVED') return
  const amount = roundMoney(bill.amount)
  if (amount <= 0) return

  const companyId = await resolveCompanyIdForOutlet(db, bill.outletId)
  if (!companyId) return

  const [arAccountId, salesRevenueAccountId] = await Promise.all([
    resolveAccountId(db, { companyId, key: 'ACCOUNTS_RECEIVABLE' }),
    resolveAccountId(db, { companyId, key: 'SALES_REVENUE' }),
  ])
  const { id: journalEntryId } = await postJournalEntry(db, {
    companyId, entryDate: bill.date, sourceModule: 'SALES', sourceType: 'SignedBill', sourceId: bill.id,
    description: `Credit sale — ${bill.billType} bill`, createdById,
    lines: [
      { accountId: arAccountId, debit: amount, outletId: bill.outletId, description: 'Credit sale' },
      { accountId: salesRevenueAccountId, credit: amount, outletId: bill.outletId, description: 'Credit sale' },
    ],
  })
  await db.signedBill.update({ where: { id: bill.id }, data: { journalEntryId } })
}

interface PaidBillForPosting {
  id: string
  signedBillId: string | null
  amountPaid: number
  paymentMethod: string
  outletId: string
  journalEntryId: string | null
  date: Date
}

/**
 * Posts a receipt against a credit sale — Dr Cash/Bank (per paymentMethod's
 * mapped GL account) / Cr Accounts Receivable. No-ops for unlinked/
 * unallocated credits (signedBillId null — nothing to clear yet) and for a
 * SignedBill whose credit sale was never itself posted (its journalEntryId
 * is null — e.g. a request bill still pending approval), since there is no
 * recognized receivable to draw down against.
 */
export async function postReceipt(db: Db, paidBill: PaidBillForPosting, createdById: string): Promise<void> {
  if (paidBill.journalEntryId) return
  if (!paidBill.signedBillId) return
  const amount = roundMoney(paidBill.amountPaid)
  if (amount <= 0) return

  const signedBill = await db.signedBill.findUnique({ where: { id: paidBill.signedBillId }, select: { journalEntryId: true } })
  if (!signedBill?.journalEntryId) return

  const companyId = await resolveCompanyIdForOutlet(db, paidBill.outletId)
  if (!companyId) return

  const [cashAccountId, arAccountId] = await Promise.all([
    resolveChannelAccountId(db, { companyId, channelCode: paidBill.paymentMethod, outletId: paidBill.outletId }),
    resolveAccountId(db, { companyId, key: 'ACCOUNTS_RECEIVABLE' }),
  ])
  const { id: journalEntryId } = await postJournalEntry(db, {
    companyId, entryDate: paidBill.date, sourceModule: 'SALES', sourceType: 'PaidBill', sourceId: paidBill.id,
    description: `Receipt via ${paidBill.paymentMethod}`, createdById,
    lines: [
      { accountId: cashAccountId, debit: amount, outletId: paidBill.outletId, description: 'Receipt' },
      { accountId: arAccountId, credit: amount, outletId: paidBill.outletId, description: 'Receipt' },
    ],
  })
  await db.paidBill.update({ where: { id: paidBill.id }, data: { journalEntryId } })
}

export interface CreditLimitResult {
  limitExceeded: boolean
  exceededAmount: number
  /** The effective limit that applied (0 = none). */
  limit: number
  /** Where the limit came from — see resolveEffectiveLimit. */
  limitSource: LimitSource
  /** The configured over-limit behavior (BLOCK | WARN | APPROVE). */
  behavior: OverLimitBehavior
}

/**
 * Config-driven credit-limit check for a new bill. The effective limit is
 * resolved through the Credit Framework (account override → group ceiling →
 * legacy Person.creditLimit for ADMIN/DIRECTOR), and the over-limit behavior
 * (BLOCK/WARN/APPROVE) comes from the resolved module config. Backward
 * compatible: with the current seed (group maxCredit = 0, no overrides, WARN)
 * this reduces to exactly today's behavior — warn-only, and only ADMIN/DIRECTOR
 * person limits fire. A limit of 0 means "no limit configured", never blocks.
 * Total exposure is the person's non-PAID signed bills + the new amount
 * (unchanged from the original person-wide check).
 */
export async function checkCreditLimit(db: Db, opts: { personId?: string | null; billType: string; newAmount: number; outletId?: string | null }): Promise<CreditLimitResult> {
  const [effective, config] = await Promise.all([
    resolveEffectiveLimit(db, { personId: opts.personId, billType: opts.billType, outletId: opts.outletId }),
    resolveCreditModuleConfig(db, { outletId: opts.outletId }),
  ])
  const base = { limit: effective.limit, limitSource: effective.source, behavior: config.allowOverLimit }
  if (!opts.personId || effective.limit <= 0) return { limitExceeded: false, exceededAmount: 0, ...base }

  const outstanding = await db.signedBill.aggregate({ where: { personId: opts.personId, status: { not: 'PAID' } }, _sum: { amount: true } })
  const totalOwed = roundMoney((outstanding._sum.amount || 0) + opts.newAmount)
  if (totalOwed > effective.limit) return { limitExceeded: true, exceededAmount: roundMoney(totalOwed - effective.limit), ...base }
  return { limitExceeded: false, exceededAmount: 0, ...base }
}

export interface WriteOffInput {
  signedBillId: string
  amount: number
  reason?: string | null
  createdById: string
}

/**
 * Writes off some or all of a SignedBill's remaining balance — Dr Bad Debt
 * Expense / Cr Accounts Receivable — and marks the bill WRITTEN_OFF once
 * paid+written-off covers the full amount. If the credit sale itself was
 * never posted to the GL (journalEntryId null), there's no receivable to
 * clear, so the write-off is recorded for bookkeeping only, with no journal
 * entry — mirrors the Grn.needsCosting "never block on missing prior data"
 * pattern.
 */
export async function writeOffSignedBill(input: WriteOffInput): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.signedBill.findUnique({ where: { id: input.signedBillId }, include: { payments: true, writeOffs: true } })
    if (!bill) throw new Error('Bill not found')
    if (bill.status === 'PAID' || bill.status === 'WRITTEN_OFF') throw new Error(`This bill is already ${bill.status.toLowerCase()}`)

    const totalPaid = roundMoney(bill.payments.reduce((s, p) => s + p.amountPaid, 0))
    const totalWrittenOff = roundMoney(bill.writeOffs.reduce((s, w) => s + w.amount, 0))
    const outstanding = roundMoney(bill.amount - totalPaid - totalWrittenOff)
    const amount = roundMoney(input.amount)
    if (amount <= 0) throw new Error('Write-off amount must be positive')
    if (amount > outstanding + 0.001) throw new Error(`Write-off of ${amount} exceeds the outstanding balance (${outstanding})`)

    let journalEntryId: string | null = null
    if (bill.journalEntryId) {
      const companyId = await resolveCompanyIdForOutlet(tx, bill.outletId)
      if (companyId) {
        const [badDebtAccountId, arAccountId] = await Promise.all([
          resolveAccountId(tx, { companyId, key: 'BAD_DEBT_EXPENSE' }),
          resolveAccountId(tx, { companyId, key: 'ACCOUNTS_RECEIVABLE' }),
        ])
        const posted = await postJournalEntry(tx, {
          companyId, entryDate: new Date(), sourceModule: 'SALES', sourceType: 'SignedBillWriteOff', sourceId: null,
          description: `Bad debt write-off — ${bill.billType} bill for ${bill.personName}`, createdById: input.createdById,
          lines: [
            { accountId: badDebtAccountId, debit: amount, outletId: bill.outletId, description: 'Bad debt write-off' },
            { accountId: arAccountId, credit: amount, outletId: bill.outletId, description: 'Bad debt write-off' },
          ],
        })
        journalEntryId = posted.id
      }
    }

    const writeOff = await tx.signedBillWriteOff.create({
      data: { signedBillId: bill.id, amount, reason: input.reason || null, createdById: input.createdById, journalEntryId },
    })
    await tx.journalEntry.updateMany({ where: { id: journalEntryId || '__none__' }, data: { sourceId: writeOff.id } })

    const fullyCovered = roundMoney(totalPaid + totalWrittenOff + amount) >= roundMoney(bill.amount) - 0.001
    if (fullyCovered) await tx.signedBill.update({ where: { id: bill.id }, data: { status: 'WRITTEN_OFF' } })

    return { id: writeOff.id }
  })
}
