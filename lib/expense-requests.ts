// The Universal Expense & Disbursement Framework's request lifecycle —
// create → submit → decide, plus the shared "recompute payment status from
// allocations" helper lib/expense-payments.ts calls after posting a payment.
// Mirrors the transaction/validation shape of lib/finance.ts's
// createSupplierPayment (allocations must sum exactly, everything happens
// inside one prisma.$transaction). See prisma/schema.prisma (Expense &
// Disbursement section) and docs/expense-disbursement-framework-design.md.
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'
import { computeActual } from '@/lib/finance-budget'
import type { BudgetValidationMode, ExpenseRequestStatus } from '@/lib/expense-config'
import { openNextApprovalStep, cancelPendingExpenseApproval } from '@/lib/expense-workflow'

function parseRoleList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseIdList(raw: string | null | undefined): string[] | null {
  if (!raw) return null // null = no restriction
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : null
  } catch {
    return null
  }
}

export interface ExpenseItemInput {
  detail: string
  unit?: number
  unitCost?: number
  amount: number
}

export interface CreateExpenseRequestInput {
  companyId: string
  requestTypeId: string
  categoryId: string
  requestedById: string
  amount?: number // computed from items when omitted
  currency?: string
  purpose: string
  outletId?: string | null
  departmentId?: string | null
  eventId?: string | null
  dueDate?: Date | null
  items?: ExpenseItemInput[]
}

export interface CreateExpenseRequestResult {
  id: string
  status: ExpenseRequestStatus
  amount: number
  budgetWarning: string | null
}

/**
 * Create a DRAFT ExpenseRequest (+ optional ExpenseItem lines). Validates the
 * request type / category are active and allowed together, the category
 * spending limit (hard ceiling), and — when the category has a
 * budgetAccountId and the request type's budgetValidation isn't NONE — the
 * company-level Budget for that account (Stage 16 decision 3: company-level
 * only in Phase 1, so this only ever looks at outletId=null Budget rows).
 * BLOCK throws; WARN returns a non-fatal budgetWarning string; a category
 * with no budgetAccountId or no matching Budget row is a no-op either way —
 * you can't validate against a budget nobody configured.
 */
export async function createExpenseRequest(db: Db, input: CreateExpenseRequestInput): Promise<CreateExpenseRequestResult> {
  const purpose = input.purpose.trim()
  if (!purpose) throw new Error('Purpose is required')

  const requestType = await db.requestType.findUnique({ where: { id: input.requestTypeId } })
  if (!requestType || !requestType.isActive) throw new Error('Request type not found or inactive')

  const category = await db.expenseCategory.findUnique({ where: { id: input.categoryId } })
  if (!category || !category.isActive) throw new Error('Expense category not found or inactive')

  const allowedCategoryIds = parseIdList(requestType.allowedCategoryIds)
  if (allowedCategoryIds && !allowedCategoryIds.includes(category.id)) {
    throw new Error(`${category.name} is not an allowed category for ${requestType.name}`)
  }

  const items = input.items ?? []
  const amount = roundMoney(input.amount ?? items.reduce((s, it) => s + it.amount, 0))
  if (amount <= 0) throw new Error('Amount must be greater than zero')

  if (category.spendingLimit > 0 && amount > category.spendingLimit) {
    throw new Error(`Amount ${amount} exceeds the ${category.name} category limit of ${category.spendingLimit}`)
  }

  let budgetWarning: string | null = null
  if (requestType.budgetValidation !== 'NONE' && category.budgetAccountId) {
    const now = new Date()
    const budget = await db.budget.findFirst({
      where: { companyId: input.companyId, accountId: category.budgetAccountId, outletId: null, periodStart: { lte: now }, periodEnd: { gte: now } },
    })
    if (budget) {
      const actual = await computeActual({ companyId: input.companyId, accountId: category.budgetAccountId, periodStart: budget.periodStart, periodEnd: budget.periodEnd })
      const projected = roundMoney(actual + amount)
      if (projected > budget.amount) {
        const message = `This request would bring ${category.name} spend to ${projected}, over its budget of ${budget.amount}`
        if ((requestType.budgetValidation as BudgetValidationMode) === 'BLOCK') throw new Error(message)
        budgetWarning = message
      }
    }
  }

  const request = await db.expenseRequest.create({
    data: {
      companyId: input.companyId,
      requestTypeId: requestType.id,
      categoryId: category.id,
      requestedById: input.requestedById,
      amount,
      currency: input.currency || 'TZS',
      purpose,
      status: 'DRAFT',
      outletId: input.outletId || null,
      departmentId: input.departmentId || null,
      eventId: input.eventId || null,
      dueDate: input.dueDate || null,
      items: items.length ? { create: items.map((it) => ({ detail: it.detail, unit: it.unit ?? 1, unitCost: it.unitCost ?? 0, amount: roundMoney(it.amount) })) } : undefined,
    },
  })

  return { id: request.id, status: request.status as ExpenseRequestStatus, amount: request.amount, budgetWarning }
}

/**
 * DRAFT → PENDING_APPROVAL when the request type has approver roles
 * configured (opening the first WorkflowApproval level via
 * lib/expense-workflow.ts), else straight to APPROVED (mirrors CreditGroup's
 * requiresApproval / approvalRequiredDefault behavior: no approvers
 * configured ⇒ nothing to wait for).
 */
export async function submitExpenseRequest(db: Db, requestId: string): Promise<{ status: ExpenseRequestStatus }> {
  const request = await db.expenseRequest.findUnique({ where: { id: requestId }, include: { requestType: true } })
  if (!request) throw new Error('Expense request not found')
  if (request.status !== 'DRAFT') throw new Error(`Cannot submit a request in status ${request.status}`)

  const roles = parseRoleList(request.requestType.approverRoles)
  const status: ExpenseRequestStatus = roles.length ? 'PENDING_APPROVAL' : 'APPROVED'
  await db.expenseRequest.update({ where: { id: requestId }, data: { status } })
  if (status === 'PENDING_APPROVAL') await openNextApprovalStep(db, requestId)
  return { status }
}

// decideExpenseRequest (M3's direct status flip) is superseded by
// lib/expense-workflow.ts's decideExpenseRequestViaWorkflow, which resolves
// the actual WorkflowApproval row so a decision never leaves a dangling
// entry in the shared approvals inbox. Removed rather than kept as a second,
// unsafe way to reach the same transition.

/** DRAFT | PENDING_APPROVAL → CANCELLED. Once a request has any payment
 *  allocation it can no longer be cancelled — reverse the payment instead.
 *  Also rejects any dangling PENDING WorkflowApproval row for this request. */
export async function cancelExpenseRequest(db: Db, requestId: string): Promise<{ status: ExpenseRequestStatus }> {
  const request = await db.expenseRequest.findUnique({ where: { id: requestId }, include: { _count: { select: { paymentAllocations: true } } } })
  if (!request) throw new Error('Expense request not found')
  if (request._count.paymentAllocations > 0) throw new Error('Cannot cancel a request that already has payments — reverse the payment instead')
  if (request.status !== 'DRAFT' && request.status !== 'PENDING_APPROVAL') throw new Error(`Cannot cancel a request in status ${request.status}`)

  await db.expenseRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED' } })
  await cancelPendingExpenseApproval(db, requestId)
  return { status: 'CANCELLED' }
}

/**
 * Recompute an ExpenseRequest's status from the sum of its
 * PaymentAllocations vs. its amount — called by lib/expense-payments.ts
 * inside the same transaction as the payment it just posted. Only advances
 * APPROVED/PARTIALLY_PAID forward (never demotes a VERIFIED/CLOSED request),
 * matching the "payment ≠ closure" invariant: this only ever reaches PAID,
 * never CLOSED — CLOSED is Stage 10/M5's verification workflow's job.
 */
export async function recalcExpenseRequestPaymentStatus(db: Db, requestId: string): Promise<ExpenseRequestStatus> {
  const request = await db.expenseRequest.findUniqueOrThrow({ where: { id: requestId }, include: { paymentAllocations: true } })
  if (request.status !== 'APPROVED' && request.status !== 'PARTIALLY_PAID') return request.status as ExpenseRequestStatus

  const paid = roundMoney(request.paymentAllocations.reduce((s, a) => s + a.amount, 0))
  const status: ExpenseRequestStatus = paid + 0.001 >= request.amount ? 'PAID' : 'PARTIALLY_PAID'
  if (status !== request.status) await db.expenseRequest.update({ where: { id: requestId }, data: { status } })
  return status
}
