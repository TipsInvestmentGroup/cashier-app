import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { advanceExpenseApproval } from '@/lib/expense-workflow'

/** Approve or reject a pending WorkflowApproval, and carry the decision onto its CollectionStageRecord. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const approval = await prisma.workflowApproval.findUnique({ where: { id } })
  if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
  if (approval.status !== 'PENDING') return NextResponse.json({ error: 'This approval has already been resolved' }, { status: 409 })

  const canDecide = user.role === 'ADMIN' || user.role === approval.approverRole || (await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_APPROVALS, 'edit'))
  if (!canDecide) return NextResponse.json({ error: 'You are not authorized to decide this approval' }, { status: 403 })

  const { decision, comment } = await req.json().catch(() => ({}))
  if (decision !== 'APPROVED' && decision !== 'REJECTED') return NextResponse.json({ error: 'decision must be APPROVED or REJECTED' }, { status: 400 })

  await prisma.$transaction(async (tx) => {
    await tx.workflowApproval.update({ where: { id }, data: { status: decision, resolvedAt: new Date(), comment: comment ? String(comment) : approval.comment } })
    if (approval.stageRecordId) {
      await tx.collectionStageRecord.update({
        where: { id: approval.stageRecordId },
        data: { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED', approvedById: user.userId },
      })
    }
    if (approval.transactionId) {
      await tx.staffTransaction.update({
        where: { id: approval.transactionId },
        data: { status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED' },
      })
    }
    // Universal Expense & Disbursement Framework bridge (M4): the row itself
    // was just updated above like every other kind; this only cascades onto
    // the ExpenseRequest — opening the next sequential approval level, or
    // finalizing APPROVED/REJECTED. See lib/expense-workflow.ts.
    if (approval.expenseRequestId) {
      await advanceExpenseApproval(tx, approval.expenseRequestId, decision)
    }
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'WorkflowApproval', entityId: id, details: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'} approval for ${approval.stageRecordId ? `stage record ${approval.stageRecordId}` : approval.transactionId ? `transaction ${approval.transactionId}` : `expense request ${approval.expenseRequestId}`}` },
  })

  return NextResponse.json({ ok: true })
}
