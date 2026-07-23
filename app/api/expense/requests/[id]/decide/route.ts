import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { decideExpenseRequestViaWorkflow } from '@/lib/expense-workflow'

/**
 * POST — approve or reject the CURRENT pending approval level for a
 * PENDING_APPROVAL request. Body: { approve: boolean, comment?: string }.
 * Role-gated against that specific level's WorkflowApproval.approverRole
 * (not the request type's full approverRoles list — a level-1 MANAGER can't
 * also clear a level-2 DIRECTOR step); ADMIN always passes. Delegates to
 * lib/expense-workflow.ts so the decision is recorded on the real
 * WorkflowApproval row and this request shows/clears correctly in the shared
 * approvals inbox (/api/collection-approvals) either way it's decided.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.expenseRequest.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const pending = await prisma.workflowApproval.findFirst({ where: { expenseRequestId: id, status: 'PENDING' } })
  if (!pending) return NextResponse.json({ error: 'This request has no pending approval to decide' }, { status: 409 })
  if (user.role !== 'ADMIN' && user.role !== pending.approverRole) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (typeof body.approve !== 'boolean') return NextResponse.json({ error: 'approve (boolean) is required' }, { status: 400 })

  try {
    const result = await decideExpenseRequestViaWorkflow({
      expenseRequestId: id, approve: body.approve, decidedById: user.userId, comment: body.comment ? String(body.comment) : null,
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseRequest', entityId: id, details: `${body.approve ? 'Approved' : 'Rejected'} (${result.approverRole} level) expense request${body.comment ? `: ${body.comment}` : ''}` },
    })
    return NextResponse.json({ status: result.status })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to decide request' }, { status: 400 })
  }
}
