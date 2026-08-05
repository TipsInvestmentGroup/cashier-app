import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { advanceExpenseApproval, isStageGrant } from '@/lib/expense-workflow'
import { hasGrant } from '@/lib/expense-grants'
import { fundClassOf } from '@/lib/expense-funds'

/** Approve or reject a pending WorkflowApproval, and carry the decision onto its CollectionStageRecord. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const approval = await prisma.workflowApproval.findUnique({ where: { id } })
  if (!approval) return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
  if (approval.status !== 'PENDING') return NextResponse.json({ error: 'This approval has already been resolved' }, { status: 409 })

  // An expense approval is addressed to a GRANT (FIRST_APPROVER/SECOND_APPROVER
  // for a fund + outlet), so role equality is the wrong test for those — without
  // this, anyone sharing the approver's job title could decide it, which is
  // exactly what §4's access layer exists to prevent. Rows whose approverRole is
  // a User.role predate that layer and keep the role test.
  let canDecide = user.role === 'ADMIN' || (await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_APPROVALS, 'edit'))
  if (!canDecide) {
    if (approval.expenseRequestId && isStageGrant(approval.approverRole)) {
      const request = await prisma.expenseRequest.findUnique({
        where: { id: approval.expenseRequestId },
        select: { outletId: true, fundingSource: { select: { sourceType: true, outletId: true } } },
      })
      const fundClass = request?.fundingSource ? fundClassOf(request.fundingSource.sourceType) : null
      const outletId = request?.fundingSource?.outletId ?? request?.outletId ?? null
      canDecide = await hasGrant(user.userId, approval.approverRole, { fundClass, outletId })
    } else {
      canDecide = user.role === approval.approverRole
    }
  }
  if (!canDecide) return NextResponse.json({ error: 'You are not authorized to decide this approval' }, { status: 403 })

  const { decision, comment, allocatedAmount } = await req.json().catch(() => ({}))
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
      // allocatedAmount only bites when this decision finalizes an IN top-up
      // (advanceExpenseApproval applies it at the execution point); for every
      // other case it is harmlessly ignored.
      await advanceExpenseApproval(tx, approval.expenseRequestId, decision, {
        allocatedAmount: allocatedAmount != null ? Number(allocatedAmount) : null,
        actorId: user.userId, actorName: user.name,
      })
    }
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'WorkflowApproval', entityId: id, details: `${decision === 'APPROVED' ? 'Approved' : 'Rejected'} approval for ${approval.stageRecordId ? `stage record ${approval.stageRecordId}` : approval.transactionId ? `transaction ${approval.transactionId}` : `expense request ${approval.expenseRequestId}`}` },
  })

  return NextResponse.json({ ok: true })
}
