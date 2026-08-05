// The Universal Expense & Disbursement Framework's payment engine — turns an
// approved ExpenseRequest into a real disbursement: one ExpensePayment (from
// one FundingSource) allocated across one or more ExpenseRequests, GL-posted
// through the single lib/ledger.ts postJournalEntry() choke point, and its
// funding source balance updated per the CASH-vs-account-backed split locked
// in Stage 16 decision 2 (see docs/expense-disbursement-framework-design.md).
// Mirrors lib/finance.ts's createSupplierPayment: owns its own
// prisma.$transaction, allocations must sum exactly to the payment amount.
//
// Note on PaymentVerification (Stage 8): that model is shaped for INBOUND
// customer/collection receipts (customerName, matchedStageId → a
// ReconciliationStage) — reusing it for an OUTBOUND expense disbursement
// would be a semantic misfit, not a clean integration. ExpensePayment.
// verificationId stays in the schema for a later phase with a real
// touchpoint; this file does not populate it.
import { prisma } from '@/lib/prisma'
import type { Db } from '@/lib/ledger'
import { postJournalEntry } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'
import { resolveAccountId, resolveChannelAccountId } from '@/lib/finance-mapping'
import { recalcExpenseRequestPaymentStatus } from '@/lib/expense-requests'
import { getFundingSourceBalance } from '@/lib/expense-ledger'
import { createNotification } from '@/lib/notifications'

function parseIdList(raw: string | null | undefined): string[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : null
  } catch {
    return null
  }
}

/** Resolves the Cr (money-out) GL account for a funding source. CASH posts to
 *  the company's default Cash account (same account Daily Collections use);
 *  BANK/MOBILE_MONEY/CARD post to the wrapped CompanyPaymentAccount's own GL
 *  account — never a separately-materialized figure (Stage 16 decision 2).
 *  OTHER has no GL representation yet — an honest gap, not a silent wrong
 *  posting; see Stage 16 "deliberately deferred, not missing". */
async function resolveFundingSourceAccountId(
  db: Db,
  fundingSource: { sourceType: string; companyPaymentAccountId: string | null; companyPaymentAccount: { glAccountId: string } | null },
  companyId: string,
  outletId?: string | null,
): Promise<string> {
  if (fundingSource.sourceType === 'CASH') {
    return resolveChannelAccountId(db, { companyId, channelCode: 'CASH', outletId })
  }
  if (fundingSource.companyPaymentAccount) {
    return fundingSource.companyPaymentAccount.glAccountId
  }
  throw new Error('OTHER funding sources have no GL account configured yet — use a CASH or bank/mobile-money/card funding source, or add a CompanyPaymentAccount for this one')
}

export interface PaymentAllocationInput {
  expenseRequestId: string
  amount: number
}

export interface CreateExpensePaymentInput {
  companyId: string
  fundingSourceId: string
  paymentMethod: string
  payeeName?: string | null
  payeeAccount?: string | null
  reference?: string | null
  paidAt?: Date
  paidById: string
  outletId?: string | null
  allocations: PaymentAllocationInput[]
}

export interface CreateExpensePaymentResult {
  id: string
  journalEntryId: string
  amount: number
  requestStatuses: Record<string, string>
}

export async function createExpensePayment(input: CreateExpensePaymentInput): Promise<CreateExpensePaymentResult> {
  if (!input.allocations.length) throw new Error('At least one allocation is required')
  const amount = roundMoney(input.allocations.reduce((s, a) => s + roundMoney(a.amount), 0))
  if (amount <= 0) throw new Error('Amount must be greater than zero')
  const paidAt = input.paidAt || new Date()

  return prisma.$transaction(async (tx) => {
    const fundingSource = await tx.fundingSource.findUnique({ where: { id: input.fundingSourceId }, include: { companyPaymentAccount: { select: { glAccountId: true } } } })
    if (!fundingSource || !fundingSource.isActive) throw new Error('Funding source not found or inactive')

    const requests = await tx.expenseRequest.findMany({
      where: { id: { in: input.allocations.map((a) => a.expenseRequestId) } },
      include: { category: true, requestType: { select: { allowedFundingSourceIds: true, name: true } }, paymentAllocations: true },
    })

    let totalDr = 0
    const drByCategoryAccount = new Map<string, number>() // categoryId -> amount, resolved to accountId below
    const categoryById = new Map<string, { id: string; name: string; budgetAccountId: string | null }>()

    for (const alloc of input.allocations) {
      const request = requests.find((r) => r.id === alloc.expenseRequestId)
      if (!request) throw new Error(`Expense request ${alloc.expenseRequestId} not found`)
      // A direction=IN row is a fund TOP-UP request, not a disbursement — it
      // brings money into the fund and is settled by an allocation, never by a
      // payment out. It would otherwise pass the status gate below (an approved
      // top-up is APPROVED), so paying against one would move money the wrong
      // way and credit the ledger twice. Guarded here rather than only at the
      // API layer because this is the single choke point every payment path
      // goes through.
      if (request.direction === 'IN') {
        throw new Error(`"${request.purpose}" is a top-up request, not a payable expense`)
      }
      if (request.status !== 'APPROVED' && request.status !== 'PARTIALLY_PAID') {
        throw new Error(`Request "${request.purpose}" is ${request.status}, not payable`)
      }
      const allowedSources = parseIdList(request.requestType.allowedFundingSourceIds)
      if (allowedSources && !allowedSources.includes(fundingSource.id)) {
        throw new Error(`${fundingSource.name} is not an allowed funding source for ${request.requestType.name}`)
      }
      const alreadyPaid = roundMoney(request.paymentAllocations.reduce((s, a) => s + a.amount, 0))
      const outstanding = roundMoney(request.amount - alreadyPaid)
      const allocAmount = roundMoney(alloc.amount)
      if (allocAmount > outstanding + 0.001) {
        throw new Error(`Allocation of ${allocAmount} exceeds outstanding balance (${outstanding}) on request "${request.purpose}"`)
      }

      categoryById.set(request.category.id, { id: request.category.id, name: request.category.name, budgetAccountId: request.category.budgetAccountId })
      drByCategoryAccount.set(request.category.id, roundMoney((drByCategoryAccount.get(request.category.id) || 0) + allocAmount))
      totalDr = roundMoney(totalDr + allocAmount)
    }
    if (totalDr !== amount) throw new Error(`Allocations (${totalDr}) must add up to the payment amount (${amount})`)

    // Balance + daily-limit checks BEFORE posting, inside the transaction.
    // CASHIER_DRAWER reads its balance live (the assigned cashier's current
    // cash-recon position, Petty Cash Custodian scenario A) rather than a
    // materialized figure, same live-read treatment as BANK/MOBILE_MONEY/CARD.
    if (fundingSource.sourceType === 'CASH' || fundingSource.sourceType === 'CASHIER_DRAWER') {
      const available = await getFundingSourceBalance(tx, fundingSource)
      if (amount > available + 0.001) {
        throw new Error(`Insufficient balance in ${fundingSource.name}: ${available} available, ${amount} requested`)
      }
    }
    if (fundingSource.dailyLimit > 0) {
      const dayStart = new Date(paidAt); dayStart.setUTCHours(0, 0, 0, 0)
      const dayEnd = new Date(paidAt); dayEnd.setUTCHours(23, 59, 59, 999)
      const todaysPayments = await tx.expensePayment.findMany({ where: { fundingSourceId: fundingSource.id, paidAt: { gte: dayStart, lte: dayEnd } }, select: { amount: true } })
      const spentToday = roundMoney(todaysPayments.reduce((s, p) => s + p.amount, 0))
      if (roundMoney(spentToday + amount) > fundingSource.dailyLimit + 0.001) {
        throw new Error(`This payment would exceed ${fundingSource.name}'s daily limit of ${fundingSource.dailyLimit} (${spentToday} already disbursed today)`)
      }
    }

    // Dr — one line per distinct category account (falls back to the
    // "Petty Cash Expense (unclassified)" system account when a category has
    // no budgetAccountId configured yet, so posting never blocks on setup).
    const lines: { accountId: string; debit?: number; credit?: number; description: string; outletId?: string | null }[] = []
    for (const [categoryId, catAmount] of drByCategoryAccount) {
      const category = categoryById.get(categoryId)!
      const accountId = category.budgetAccountId || (await resolveAccountId(tx, { companyId: input.companyId, outletId: input.outletId, key: 'PETTY_CASH_EXPENSE' }))
      lines.push({ accountId, debit: catAmount, description: `Expense: ${category.name}`, outletId: input.outletId })
    }
    // Cr — the funding source's own GL account.
    const fundingAccountId = await resolveFundingSourceAccountId(tx, fundingSource, input.companyId, input.outletId)
    lines.push({ accountId: fundingAccountId, credit: amount, description: `Paid via ${fundingSource.name}`, outletId: input.outletId })

    const { id: journalEntryId } = await postJournalEntry(tx, {
      companyId: input.companyId, entryDate: paidAt, sourceModule: 'EXPENSE',
      sourceType: 'ExpensePayment', sourceId: null, description: `Expense payment via ${fundingSource.name}`,
      createdById: input.paidById, lines,
    })

    const payment = await tx.expensePayment.create({
      data: {
        fundingSourceId: fundingSource.id, amount, paymentMethod: input.paymentMethod,
        payeeName: input.payeeName || null, payeeAccount: input.payeeAccount || null, reference: input.reference || null,
        paidAt, paidById: input.paidById, journalEntryId,
      },
    })
    await tx.journalEntry.update({ where: { id: journalEntryId }, data: { sourceId: payment.id } })

    for (const alloc of input.allocations) {
      await tx.paymentAllocation.create({ data: { expensePaymentId: payment.id, expenseRequestId: alloc.expenseRequestId, amount: roundMoney(alloc.amount) } })
    }

    if (fundingSource.sourceType === 'CASH') {
      await tx.fundingSource.update({ where: { id: fundingSource.id }, data: { currentBalance: roundMoney(fundingSource.currentBalance - amount) } })
    }
    // Every CASH/CASHIER_DRAWER payment gets a Petty Cash Ledger row — CASH
    // also updates its materialized currentBalance above; CASHIER_DRAWER's
    // balance is always read live, so this row is purely the audit trail.
    if (fundingSource.sourceType === 'CASH' || fundingSource.sourceType === 'CASHIER_DRAWER') {
      await tx.fundingSourceTxn.create({
        data: { fundingSourceId: fundingSource.id, type: 'PAYMENT', amount: -amount, reference: input.reference || null, expensePaymentId: payment.id, createdById: input.paidById },
      })
    }

    const requestStatuses: Record<string, string> = {}
    for (const requestId of new Set(input.allocations.map((a) => a.expenseRequestId))) {
      requestStatuses[requestId] = await recalcExpenseRequestPaymentStatus(tx, requestId)
    }

    return { id: payment.id, journalEntryId, amount, requestStatuses, requests }
  })
    .then(async (result) => {
      // Requester notification: "Partially Paid" / "Fully Paid" — the last two
      // of the request's spec'd lifecycle events (Submitted/Approved/Rejected
      // notify elsewhere in lib/expense-requests.ts / lib/expense-workflow.ts).
      await Promise.all(Object.entries(result.requestStatuses).map(async ([requestId, status]) => {
        if (status !== 'PARTIALLY_PAID' && status !== 'PAID') return
        const req = result.requests.find((r) => r.id === requestId)
        if (!req) return
        await createNotification({
          userId: req.requestedById,
          type: status === 'PAID' ? 'EXPENSE_REQUEST_PAID' : 'EXPENSE_REQUEST_PARTIALLY_PAID',
          title: status === 'PAID' ? `${req.requestType.name} paid` : `${req.requestType.name} partially paid`,
          message: `"${req.purpose}" for ${req.amount} ${req.currency} has been ${status === 'PAID' ? 'fully paid' : 'partially paid'}.`,
          entityType: 'ExpenseRequest', entityId: requestId,
        }).catch(() => {})
      }))
      return { id: result.id, journalEntryId: result.journalEntryId, amount: result.amount, requestStatuses: result.requestStatuses }
    })
}
