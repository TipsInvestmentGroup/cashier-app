// §8 — petty cash top-up requests. A top-up is just an ExpenseRequest with
// direction=IN, so it reuses the entire create → submit → approve → execute
// machinery rather than forking a parallel table or flow. This module only adds
// the two things that are genuinely top-up-specific: the request type/category a
// top-up is filed under, and the custodian-authorized entry point that creates
// and submits one in a single step.
//
// The custodian sits in the requester's seat here (the brief's reversed flow),
// and per the 2026-08-05 decision the Second Approver's approval executes the
// allocation directly — that execution lives in lib/expense-workflow.ts
// (executeTopUpAllocation), reached through the normal approval cascade, so
// nothing top-up-specific is needed for it here.
import type { Db } from '@/lib/ledger'
import { createExpenseRequest, submitExpenseRequest } from '@/lib/expense-requests'
import type { ExpenseRequestStatus } from '@/lib/expense-config'

const TOP_UP_REQUEST_TYPE_CODE = 'PETTY_CASH_TOPUP'
const TOP_UP_CATEGORY_CODE = 'FUND_TOPUP'

/**
 * Resolves (creating on first use) the request type and category a top-up is
 * filed under. Idempotent upsert so it works whether or not the seed has run.
 *
 * approverRoles is set non-empty deliberately: resolveApprovalPlan reads its
 * presence purely as the "this needs approval" switch (the actual approvers come
 * from FIRST/SECOND_APPROVER grants for the fund, not from these role strings),
 * so a non-empty value is what routes a top-up through the chain. budgetValidation
 * is NONE and the category has no budget account — a top-up brings money in, it
 * is not category spend to validate.
 */
export async function ensureTopUpConfig(db: Db, companyId: string): Promise<{ requestTypeId: string; categoryId: string }> {
  const requestType = await db.requestType.upsert({
    where: { companyId_code: { companyId, code: TOP_UP_REQUEST_TYPE_CODE } },
    update: {},
    create: {
      companyId, code: TOP_UP_REQUEST_TYPE_CODE, name: 'Petty Cash Top-Up',
      description: 'Request to add funds to a petty cash fund.',
      approverRoles: JSON.stringify(['MANAGER']), // presence = "needs approval"; real approvers come from grants
      budgetValidation: 'NONE',
    },
  })
  const category = await db.expenseCategory.upsert({
    where: { companyId_code: { companyId, code: TOP_UP_CATEGORY_CODE } },
    update: {},
    create: { companyId, code: TOP_UP_CATEGORY_CODE, name: 'Fund Top-Up', spendingLimit: 0 },
  })
  return { requestTypeId: requestType.id, categoryId: category.id }
}

export interface CreateTopUpInput {
  companyId: string
  fundingSourceId: string
  requestedById: string
  amount: number
  reference?: string | null
  note?: string | null
}

/**
 * Creates a top-up request against a fund and submits it in one step, returning
 * the resulting status. A below-threshold top-up is allocated immediately
 * (status CLOSED); anything above enters the approval chain (PENDING_APPROVAL).
 * Authorization (the caller must hold Petty Cash Custodian access for the fund)
 * is enforced at the route; the allocatable-fund check lives in
 * createExpenseRequest, so a cashier/digital fund is rejected here too.
 *
 * Call inside a transaction — submit may execute the allocation, and the credit
 * + status change must be atomic.
 */
export async function createTopUpRequest(db: Db, input: CreateTopUpInput): Promise<{ id: string; status: ExpenseRequestStatus; skipReason: string | null }> {
  const source = await db.fundingSource.findUnique({ where: { id: input.fundingSourceId }, select: { outletId: true, isActive: true } })
  if (!source || !source.isActive) throw new Error('Funding source not found or inactive')

  const { requestTypeId, categoryId } = await ensureTopUpConfig(db, input.companyId)

  const created = await createExpenseRequest(db, {
    companyId: input.companyId,
    requestTypeId,
    categoryId,
    requestedById: input.requestedById,
    amount: input.amount,
    purpose: input.note?.trim() || 'Petty cash top-up',
    direction: 'IN',
    fundingSourceId: input.fundingSourceId,
    reference: input.reference ?? null,
    outletId: source.outletId,
  })

  const submitted = await submitExpenseRequest(db, created.id)
  return { id: created.id, status: submitted.status, skipReason: submitted.skipReason }
}
