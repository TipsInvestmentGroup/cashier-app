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

function parseApproverRoles(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/** The two approval stages, in order. §4 defines exactly First then Second
 *  Approver, so the chain is two-tier by design rather than an arbitrary-length
 *  role list — but stage 2 only applies when someone actually holds
 *  SECOND_APPROVER for the fund (see resolveApprovalPlan). */
const STAGE_GRANTS = ['FIRST_APPROVER', 'SECOND_APPROVER'] as const
export type ApprovalStageGrant = (typeof STAGE_GRANTS)[number]

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
 * Otherwise the chain is FIRST_APPROVER → SECOND_APPROVER, narrowed to the
 * stages that are actually staffed for this fund class and outlet. Stage 2 is
 * dropped when nobody holds SECOND_APPROVER — a two-tier chain with an empty
 * second tier would strand every request in PENDING_APPROVAL forever.
 *
 * Deliberately does NOT auto-approve when stage 1 is unstaffed: silently
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
      stages: [...(staffed.first ? (['FIRST_APPROVER'] as const) : []), ...(staffed.second ? (['SECOND_APPROVER'] as const) : [])],
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
    stages: [...(staffed.first ? (['FIRST_APPROVER'] as const) : []), ...(staffed.second ? (['SECOND_APPROVER'] as const) : [])],
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

  const approvers = await usersWithGrant(approverRole, { fundClass: plan.fundClass, outletId: plan.outletId }).catch(() => [])
  await Promise.all(approvers.map((a) => createNotification({
    userId: a.id,
    type: 'EXPENSE_REQUEST_APPROVAL_NEEDED',
    title: `${request.requestType.name} awaiting your approval`,
    message: `"${request.purpose}" for ${request.amount} ${request.currency} needs your approval.`,
    entityType: 'ExpenseRequest', entityId: expenseRequestId,
  }).catch(() => {})))

  return { approverRole }
}

/**
 * Cascades a decision that has ALREADY been written onto its WorkflowApproval
 * row (the caller — the shared /api/collection-approvals decide route —
 * updates the row generically for every approval kind) onto the
 * ExpenseRequest: REJECTED stops the whole chain immediately; APPROVED either
 * opens the next level or, once every level has approved, marks the request
 * APPROVED.
 */
export async function advanceExpenseApproval(db: Db, expenseRequestId: string, decision: 'APPROVED' | 'REJECTED'): Promise<{ status: ExpenseRequestStatus }> {
  const request = await db.expenseRequest.findUniqueOrThrow({ where: { id: expenseRequestId }, include: { requestType: true } })

  if (decision === 'REJECTED') {
    await db.expenseRequest.update({ where: { id: expenseRequestId }, data: { status: 'REJECTED' } })
    await createNotification({
      userId: request.requestedById, type: 'EXPENSE_REQUEST_REJECTED',
      title: `${request.requestType.name} rejected`,
      message: `"${request.purpose}" for ${request.amount} ${request.currency} was rejected.`,
      entityType: 'ExpenseRequest', entityId: expenseRequestId,
    }).catch(() => {})
    return { status: 'REJECTED' }
  }

  const next = await openNextApprovalStep(db, expenseRequestId)
  if (next) return { status: 'PENDING_APPROVAL' }

  await db.expenseRequest.update({ where: { id: expenseRequestId }, data: { status: 'APPROVED' } })

  await createNotification({
    userId: request.requestedById, type: 'EXPENSE_REQUEST_APPROVED',
    title: `${request.requestType.name} approved`,
    message: `"${request.purpose}" for ${request.amount} ${request.currency} has been approved.`,
    entityType: 'ExpenseRequest', entityId: expenseRequestId,
  }).catch(() => {})

  // Notify whoever can now disburse this request. When the request names a fund
  // (§3), that fund's own assigned custodians are the exact audience — far
  // narrower than the request type's allowed-funding-source list, which was the
  // best available proxy before a request carried a funding source at all. Falls
  // back to that proxy for requests created before the upgrade.
  const custodians = request.fundingSourceId
    ? await listFundingSourceCustodians(request.fundingSourceId)
      .then((rows) => rows.map((r) => ({ id: r.userId })))
      .catch(() => [])
    : await listCustodiansForRequestType(request.requestType.allowedFundingSourceIds).catch(() => [])
  await Promise.all(custodians.map((c) => createNotification({
    userId: c.id, type: 'EXPENSE_REQUEST_READY_FOR_PAYMENT',
    title: `${request.requestType.name} ready for payment`,
    message: `"${request.purpose}" for ${request.amount} ${request.currency} is approved and ready to be paid.`,
    entityType: 'ExpenseRequest', entityId: expenseRequestId,
  }).catch(() => {})))

  return { status: 'APPROVED' }
}

/**
 * Convenience entry point for lib/expense-requests.ts's own decide endpoint
 * (as opposed to the shared /api/collection-approvals inbox, which already
 * has the WorkflowApproval row in hand): finds this request's current
 * PENDING approval row, resolves it, and cascades. Owns its own transaction —
 * mirrors lib/expense-payments.ts createExpensePayment's shape.
 */
export async function decideExpenseRequestViaWorkflow(opts: { expenseRequestId: string; approve: boolean; decidedById: string; comment?: string | null }): Promise<{ status: ExpenseRequestStatus; approverRole: string }> {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.workflowApproval.findFirst({ where: { expenseRequestId: opts.expenseRequestId, status: 'PENDING' } })
    if (!approval) throw new Error('This request has no pending approval to decide')

    const decision = opts.approve ? 'APPROVED' : 'REJECTED'
    await tx.workflowApproval.update({
      where: { id: approval.id },
      data: { status: decision, resolvedAt: new Date(), approverId: opts.decidedById, comment: opts.comment ?? approval.comment },
    })
    const { status } = await advanceExpenseApproval(tx, opts.expenseRequestId, decision)
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
