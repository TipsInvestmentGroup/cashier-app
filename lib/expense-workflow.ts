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

function parseApproverRoles(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * Opens the next sequential approval level for a PENDING_APPROVAL request —
 * one WorkflowApproval row for roles[approvedCount]. Idempotent: a no-op when
 * a PENDING row already exists (guards against being called twice for the
 * same level) or when every level is already resolved.
 */
export async function openNextApprovalStep(db: Db, expenseRequestId: string): Promise<{ approverRole: string } | null> {
  const alreadyPending = await db.workflowApproval.findFirst({ where: { expenseRequestId, status: 'PENDING' } })
  if (alreadyPending) return { approverRole: alreadyPending.approverRole! }

  const request = await db.expenseRequest.findUniqueOrThrow({ where: { id: expenseRequestId }, include: { requestType: true } })
  const roles = parseApproverRoles(request.requestType.approverRoles)
  const approvedCount = await db.workflowApproval.count({ where: { expenseRequestId, status: 'APPROVED' } })
  if (approvedCount >= roles.length) return null // nothing left to open

  const approverRole = roles[approvedCount]
  await db.workflowApproval.create({
    data: {
      expenseRequestId,
      requestedById: request.requestedById,
      approverRole,
      comment: `${request.requestType.name}: ${request.purpose}${roles.length > 1 ? ` (level ${approvedCount + 1} of ${roles.length})` : ''}`,
    },
  })
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
  if (decision === 'REJECTED') {
    await db.expenseRequest.update({ where: { id: expenseRequestId }, data: { status: 'REJECTED' } })
    return { status: 'REJECTED' }
  }

  const next = await openNextApprovalStep(db, expenseRequestId)
  if (next) return { status: 'PENDING_APPROVAL' }

  await db.expenseRequest.update({ where: { id: expenseRequestId }, data: { status: 'APPROVED' } })
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
