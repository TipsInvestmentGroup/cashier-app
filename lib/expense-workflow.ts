// The Universal Expense & Disbursement Framework's approval bridge — turns
// RequestType.approverRoles (an ORDERED JSON role list) into real
// WorkflowApproval rows via the additive expenseRequestId bridge FK, so
// expense approvals show up in the existing shared approvals inbox
// (/api/collection-approvals) exactly like collection-stage and
// staff-transaction approvals already do, instead of the direct status flip
// lib/expense-requests.ts used in M3.
//
// Semantics: approverRoles is ORDERED — ["MANAGER","DIRECTOR"] means MANAGER
// must approve first, then DIRECTOR, before the request itself reaches
// APPROVED (sequential levels, one open WorkflowApproval row at a time — not
// the parallel/conditional/escalation graph a first-class WorkflowDefinition
// would add later; see Stage 16 of docs/expense-disbursement-framework-design.md).
// A REJECTED decision at any level rejects the whole request immediately.
import type { Db } from '@/lib/ledger'
import { prisma } from '@/lib/prisma'
import type { ExpenseRequestStatus } from '@/lib/expense-config'
import { createNotification } from '@/lib/notifications'
import { listCustodiansForRequestType, listFundingSourceCustodians } from '@/lib/expense-access'
import { fundClassOf, type FundClass } from '@/lib/expense-funds'
import { chainIsStaffed, usersWithGrant } from '@/lib/expense-grants'
import { creditFundingSource } from '@/lib/expense-ledger'
import { roundMoney } from '@/lib/utils'

function parseApproverRoles(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** The grants that can address an approval stage. Two shapes are possible:
 *  a single-stage SINGLE_APPROVER chain, or the two-tier FIRST → SECOND chain
 *  (each stage applying only when someone holds it for the fund — see
 *  resolveApprovalPlan). A given fund uses one shape or the other, never both:
 *  a configured Single Approver replaces the two-stage chain entirely. */
const STAGE_GRANTS = ['SINGLE_APPROVER', 'FIRST_APPROVER', 'SECOND_APPROVER'] as const
export type ApprovalStageGrant = (typeof STAGE_GRANTS)[number]

/** Turns "who is staffed" into the ordered stages that will actually run.
 *  A Single Approver takes precedence: when one is configured for the fund the
 *  request is finalized by that one approval and never enters the First/Second
 *  chain. Otherwise the chain is FIRST → SECOND, each stage included only when
 *  it is staffed (an empty second tier is dropped rather than stranding the
 *  request in PENDING_APPROVAL forever). */
function stagesFromStaffed(staffed: { single: boolean; first: boolean; second: boolean }): ApprovalStageGrant[] {
  if (staffed.single) return ['SINGLE_APPROVER']
  return [
    ...(staffed.first ? (['FIRST_APPROVER'] as const) : []),
    ...(staffed.second ? (['SECOND_APPROVER'] as const) : []),
  ]
}

/** WorkflowApproval.approverRole holds a User.role for collection-stage and
 *  staff-transaction approvals, but a GRANT TYPE for expense approvals — the
 *  whole point of §4 is that expense approval is granted per person per fund,
 *  not implied by a job title. Callers that need to tell the two apart (the
 *  shared approvals inbox, the decide endpoint) use this. */
export function isStageGrant(value: string | null | undefined): value is ApprovalStageGrant {
  return !!value && (STAGE_GRANTS as readonly string[]).includes(value)
}

export interface ApprovalPlan {
  /** No approval needed — either the request type configures none, or the
   *  amount is at/below this fund's approvalThreshold. */
  skip: boolean
  reason: string | null
  /** Stages that will actually run, in order. Empty when skip is true. */
  stages: ApprovalStageGrant[]
  fundClass: FundClass | null
  outletId: string | null
}

/**
 * Works out how a request should be approved, before anything is written.
 *
 * Three ways a request needs no approval:
 *   • its RequestType configures no approverRoles at all (unchanged from
 *     before — the "zero config ⇒ nothing to wait for" switch), or
 *   • its amount is at or below the fund's approvalThreshold (§3's
 *     small-request shortcut), or
 *   • it has no funding source, in which case there is no fund whose chain or
 *     threshold could apply and the pre-upgrade role behavior stands.
 *
 * Otherwise the chain is resolved from the grants staffed for this fund class
 * and outlet (see stagesFromStaffed): a configured SINGLE_APPROVER yields a
 * one-stage chain that finalizes on a single approval; failing that, the
 * two-tier FIRST_APPROVER → SECOND_APPROVER chain, with stage 2 dropped when
 * nobody holds SECOND_APPROVER — a two-tier chain with an empty second tier
 * would strand every request in PENDING_APPROVAL forever.
 *
 * Deliberately does NOT auto-approve when no stage is staffed: silently
 * approving money-out because an admin forgot to grant approver access is the
 * worst possible failure here. submitExpenseRequest surfaces that as an error.
 */
export async function resolveApprovalPlan(
  db: Db,
  request: { amount: number; outletId: string | null; requestType: { approverRoles: string | null }; fundingSourceId: string | null },
): Promise<ApprovalPlan> {
  const rolesConfigured = parseApproverRoles(request.requestType.approverRoles).length > 0
  if (!rolesConfigured) {
    return { skip: true, reason: 'No approvers configured for this request type', stages: [], fundClass: null, outletId: request.outletId }
  }
  if (!request.fundingSourceId) {
    // Pre-upgrade shape: no fund selected, so no per-fund chain or threshold to
    // apply. Keep requiring approval (roles ARE configured) and fall back to
    // the fund-agnostic grant scope.
    const staffed = await chainIsStaffed({ outletId: request.outletId })
    return {
      skip: false, reason: null,
      stages: stagesFromStaffed(staffed),
      fundClass: null, outletId: request.outletId,
    }
  }

  const source = await db.fundingSource.findUnique({
    where: { id: request.fundingSourceId },
    select: { sourceType: true, outletId: true, approvalThreshold: true, name: true },
  })
  if (!source) throw new Error('Funding source not found')

  const fundClass = fundClassOf(source.sourceType)
  // Scope the chain to the FUND's outlet when it has one — a fund belongs to an
  // outlet, and its approvers are the people granted access at that outlet,
  // regardless of which outlet the requester happens to sit in.
  const outletId = source.outletId ?? request.outletId

  if (source.approvalThreshold > 0 && request.amount <= source.approvalThreshold) {
    return {
      skip: true,
      reason: `At or below ${source.name}'s approval threshold of ${source.approvalThreshold}`,
      stages: [], fundClass, outletId,
    }
  }

  const staffed = await chainIsStaffed({ fundClass, outletId })
  return {
    skip: false, reason: null,
    stages: stagesFromStaffed(staffed),
    fundClass, outletId,
  }
}

/**
 * Opens the next approval stage for a PENDING_APPROVAL request — one
 * WorkflowApproval row whose approverRole is the STAGE GRANT
 * (FIRST_APPROVER/SECOND_APPROVER), not a User.role. Idempotent: a no-op when a
 * PENDING row already exists (guards against being called twice for the same
 * stage) or when every stage is resolved.
 *
 * The "action needed" notification goes to exactly the people holding that
 * grant for this fund and outlet — §7's requirement, and the reason this no
 * longer calls notifyUsersByRole, which broadcast to every holder of a job
 * title.
 */
export async function openNextApprovalStep(db: Db, expenseRequestId: string): Promise<{ approverRole: string } | null> {
  const alreadyPending = await db.workflowApproval.findFirst({ where: { expenseRequestId, status: 'PENDING' } })
  if (alreadyPending) return { approverRole: alreadyPending.approverRole! }

  const request = await db.expenseRequest.findUniqueOrThrow({ where: { id: expenseRequestId }, include: { requestType: true } })
  const plan = await resolveApprovalPlan(db, request)
  const approvedCount = await db.workflowApproval.count({ where: { expenseRequestId, status: 'APPROVED' } })
  if (plan.skip || approvedCount >= plan.stages.length) return null // nothing left to open

  const approverRole = plan.stages[approvedCount]
  await db.workflowApproval.create({
    data: {
      expenseRequestId,
      requestedById: request.requestedById,
      approverRole,
      comment: `${request.requestType.name}: ${request.purpose}${plan.stages.length > 1 ? ` (level ${approvedCount + 1} of ${plan.stages.length})` : ''}`,
    },
  })

  const approvers = await usersWithGrant(approverRole, { fundClass: plan.fundClass, outletId: plan.outletId }, db).catch(() => [])
  await Promise.all(approvers.map((a) => createNotification({
    userId: a.id,
    type: 'EXPENSE_REQUEST_APPROVAL_NEEDED',
    title: `${request.requestType.name} awaiting your approval`,
    message: `"${request.purpose}" for ${request.amount} ${request.currency} needs your approval.`,
    entityType: 'ExpenseRequest', entityId: expenseRequestId,
  }, db)))

  return { approverRole }
}

/**
 * Executes an approved petty-cash top-up (§8): creates the DEBIT ledger entry
 * that credits the fund, marks the request CLOSED, records the allocated amount
 * (which may differ from the requested amount — a cheque rounded to a whole
 * figure), and confirms receipt to the custodian who requested it.
 *
 * Per the 2026-08-05 decision the Second Approver's approval executes this
 * directly — there is no separate allocator step — so this runs INSIDE the
 * decide transaction (hence creditFundingSource, the tx-aware core, not
 * replenishFundingSource which would nest a transaction). It is also the path a
 * below-threshold top-up takes at submit time (no approval needed).
 *
 * Idempotent guard: refuses to run twice for the same request, so a double
 * decide can't credit the fund twice.
 */
export async function executeTopUpAllocation(
  db: Db,
  expenseRequestId: string,
  opts: { allocatedAmount?: number | null; actorId?: string | null; actorName?: string | null } = {},
): Promise<{ status: ExpenseRequestStatus; allocated: number }> {
  const request = await db.expenseRequest.findUniqueOrThrow({ where: { id: expenseRequestId }, include: { requestType: true } })
  if (request.direction !== 'IN') throw new Error('Not a top-up request')
  if (!request.fundingSourceId) throw new Error('Top-up request has no fund to credit')
  if (request.status === 'CLOSED') return { status: 'CLOSED', allocated: request.allocatedAmount ?? request.amount }

  const allocated = roundMoney(opts.allocatedAmount && opts.allocatedAmount > 0 ? opts.allocatedAmount : request.amount)

  await creditFundingSource(db, {
    fundingSourceId: request.fundingSourceId,
    amount: allocated,
    reference: request.reference,
    note: `Top-up: ${request.purpose}`,
    expenseRequestId,
    createdById: opts.actorId || request.requestedById,
    createdByName: opts.actorName || null,
  })

  await db.expenseRequest.update({
    where: { id: expenseRequestId },
    // CLOSED, not PAID: a top-up brings money IN, so "paid" (money out) would
    // misread. CLOSED = allocation recorded, nothing further to do.
    data: { status: 'CLOSED', allocatedAmount: allocated },
  })

  await createNotification({
    userId: request.requestedById, type: 'EXPENSE_TOPUP_ALLOCATED',
    title: `${request.requestType.name} allocated`,
    message: `Your top-up "${request.purpose}" was allocated: ${allocated} ${request.currency} is now in the fund${
      allocated !== request.amount ? ` (requested ${request.amount})` : ''
    }.`,
    entityType: 'ExpenseRequest', entityId: expenseRequestId,
  }, db)

  return { status: 'CLOSED', allocated }
}

/**
 * Cascades a decision that has ALREADY been written onto its WorkflowApproval
 * row (the caller — the shared /api/collection-approvals decide route —
 * updates the row generically for every approval kind) onto the
 * ExpenseRequest: REJECTED stops the whole chain immediately; APPROVED either
 * opens the next level or, once every level has approved, finalizes — executing
 * the allocation for an IN top-up, or marking an OUT request ready to pay.
 */
export async function advanceExpenseApproval(
  db: Db,
  expenseRequestId: string,
  decision: 'APPROVED' | 'REJECTED',
  opts: { allocatedAmount?: number | null; actorId?: string | null; actorName?: string | null } = {},
): Promise<{ status: ExpenseRequestStatus }> {
  const request = await db.expenseRequest.findUniqueOrThrow({ where: { id: expenseRequestId }, include: { requestType: true } })
  const isTopUp = request.direction === 'IN'

  if (decision === 'REJECTED') {
    await db.expenseRequest.update({ where: { id: expenseRequestId }, data: { status: 'REJECTED' } })
    await createNotification({
      userId: request.requestedById, type: 'EXPENSE_REQUEST_REJECTED',
      title: `${request.requestType.name} rejected`,
      message: `${isTopUp ? 'Your top-up' : 'Request'} "${request.purpose}" for ${request.amount} ${request.currency} was rejected.`,
      entityType: 'ExpenseRequest', entityId: expenseRequestId,
    }, db)
    return { status: 'REJECTED' }
  }

  const next = await openNextApprovalStep(db, expenseRequestId)
  if (next) return { status: 'PENDING_APPROVAL' }

  // Final approval reached. A top-up is executed here and now (the approver's
  // approval IS the allocation, per §8's decision) rather than being handed to a
  // separate allocator.
  if (isTopUp) {
    const { status } = await executeTopUpAllocation(db, expenseRequestId, opts)
    return { status }
  }

  await db.expenseRequest.update({ where: { id: expenseRequestId }, data: { status: 'APPROVED' } })

  await createNotification({
    userId: request.requestedById, type: 'EXPENSE_REQUEST_APPROVED',
    title: `${request.requestType.name} approved`,
    message: `"${request.purpose}" for ${request.amount} ${request.currency} has been approved.`,
    entityType: 'ExpenseRequest', entityId: expenseRequestId,
  }, db)

  // Notify whoever can now disburse this request. When the request names a fund
  // (§3), that fund's own assigned custodians are the exact audience — far
  // narrower than the request type's allowed-funding-source list, which was the
  // best available proxy before a request carried a funding source at all. Falls
  // back to that proxy for requests created before the upgrade.
  const custodians = request.fundingSourceId
    ? await listFundingSourceCustodians(request.fundingSourceId, db)
      .then((rows) => rows.map((r) => ({ id: r.userId })))
      .catch(() => [])
    : await listCustodiansForRequestType(request.requestType.allowedFundingSourceIds, db).catch(() => [])
  await Promise.all(custodians.map((c) => createNotification({
    userId: c.id, type: 'EXPENSE_REQUEST_READY_FOR_PAYMENT',
    title: `${request.requestType.name} ready for payment`,
    message: `"${request.purpose}" for ${request.amount} ${request.currency} is approved and ready to be paid.`,
    entityType: 'ExpenseRequest', entityId: expenseRequestId,
  }, db)))

  return { status: 'APPROVED' }
}

/**
 * Convenience entry point for lib/expense-requests.ts's own decide endpoint
 * (as opposed to the shared /api/collection-approvals inbox, which already
 * has the WorkflowApproval row in hand): finds this request's current
 * PENDING approval row, resolves it, and cascades. Owns its own transaction —
 * mirrors lib/expense-payments.ts createExpensePayment's shape.
 */
export async function decideExpenseRequestViaWorkflow(opts: { expenseRequestId: string; approve: boolean; decidedById: string; decidedByName?: string | null; comment?: string | null; allocatedAmount?: number | null }): Promise<{ status: ExpenseRequestStatus; approverRole: string }> {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.workflowApproval.findFirst({ where: { expenseRequestId: opts.expenseRequestId, status: 'PENDING' } })
    if (!approval) throw new Error('This request has no pending approval to decide')

    const decision = opts.approve ? 'APPROVED' : 'REJECTED'
    await tx.workflowApproval.update({
      where: { id: approval.id },
      data: { status: decision, resolvedAt: new Date(), approverId: opts.decidedById, comment: opts.comment ?? approval.comment },
    })
    const { status } = await advanceExpenseApproval(tx, opts.expenseRequestId, decision, {
      allocatedAmount: opts.allocatedAmount, actorId: opts.decidedById, actorName: opts.decidedByName,
    })
    return { status, approverRole: approval.approverRole! }
  })
}

/**
 * Rejects (never deletes — "reverse, never edit") any WorkflowApproval row
 * still PENDING for a request that's being cancelled, so cancelling a
 * request never leaves a dangling entry in the shared approvals inbox.
 */
export async function cancelPendingExpenseApproval(db: Db, expenseRequestId: string): Promise<void> {
  await db.workflowApproval.updateMany({
    where: { expenseRequestId, status: 'PENDING' },
    data: { status: 'REJECTED', resolvedAt: new Date(), comment: 'Request cancelled by requester' },
  })
}
