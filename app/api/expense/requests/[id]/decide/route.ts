import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { decideExpenseRequestViaWorkflow, isStageGrant } from '@/lib/expense-workflow'
import { hasGrant } from '@/lib/expense-grants'
import { fundClassOf } from '@/lib/expense-funds'

/**
 * POST — approve or reject the CURRENT pending approval level for a
 * PENDING_APPROVAL request. Body: { approve: boolean, comment?: string }.
 * Gated against that specific level's WorkflowApproval.approverRole (not the
 * request type's full approverRoles list — a level-1 approver can't also clear
 * a level-2 step). For expense requests approverRole is a STAGE GRANT
 * (FIRST_APPROVER/SECOND_APPROVER for a fund + outlet), NOT a User.role, so it
 * must be checked with hasGrant — the same test the shared approvals inbox
 * (/api/collection-approvals/[id]) uses. Checking role equality here was the
 * bug that gave every non-ADMIN approver a "Forbidden". ADMIN and holders of an
 * explicit COLLECTION_APPROVALS grant always pass. Delegates to
 * lib/expense-workflow.ts so the decision is recorded on the real
 * WorkflowApproval row and this request shows/clears correctly in the shared
 * approvals inbox either way it's decided.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.expenseRequest.findUnique({
    where: { id },
    select: { id: true, outletId: true, fundingSource: { select: { sourceType: true, outletId: true } } },
  })
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const pending = await prisma.workflowApproval.findFirst({ where: { expenseRequestId: id, status: 'PENDING' } })
  if (!pending) return NextResponse.json({ error: 'This request has no pending approval to decide' }, { status: 409 })

  let canDecide = user.role === 'ADMIN' || (await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_APPROVALS, 'edit'))
  if (!canDecide) {
    if (isStageGrant(pending.approverRole)) {
      // The chain is scoped to the FUND's outlet when it has one (mirrors
      // resolveApprovalPlan / the shared inbox), falling back to the request's.
      const fundClass = existing.fundingSource ? fundClassOf(existing.fundingSource.sourceType) : null
      const outletId = existing.fundingSource?.outletId ?? existing.outletId ?? null
      canDecide = await hasGrant(user.userId, pending.approverRole, { fundClass, outletId })
    } else {
      // Legacy rows whose approverRole is a User.role (predate the §4 grants).
      canDecide = user.role === pending.approverRole
    }
  }
  if (!canDecide) return NextResponse.json({ error: 'You are not authorized to decide this approval' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (typeof body.approve !== 'boolean') return NextResponse.json({ error: 'approve (boolean) is required' }, { status: 400 })

  // Optional approver-adjusted amount (a partial approval, or a top-up rounded
  // to a whole cheque). Only meaningful on approve, and only when the final
  // level clears — lib/expense-workflow.ts applies it at that point and stores
  // it as ExpenseRequest.allocatedAmount, leaving the requested amount intact.
  let allocatedAmount: number | null = null
  if (body.approve && body.allocatedAmount != null && body.allocatedAmount !== '') {
    const n = Number(body.allocatedAmount)
    if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'allocatedAmount must be a positive number' }, { status: 400 })
    allocatedAmount = n
  }

  try {
    const result = await decideExpenseRequestViaWorkflow({
      expenseRequestId: id, approve: body.approve, decidedById: user.userId, comment: body.comment ? String(body.comment) : null,
      allocatedAmount,
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseRequest', entityId: id, details: `${body.approve ? 'Approved' : 'Rejected'} (${result.approverRole} level) expense request${body.comment ? `: ${body.comment}` : ''}` },
    })
    return NextResponse.json({ status: result.status })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to decide request' }, { status: 400 })
  }
}
