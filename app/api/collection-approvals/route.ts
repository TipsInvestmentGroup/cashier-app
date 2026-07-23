import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'

/**
 * List pending WorkflowApprovals. A user sees approvals addressed to their
 * own role, plus ADMIN/anyone with an explicit COLLECTION_APPROVALS grant
 * sees everything (mirrors the owner/grant pattern used across the app).
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seesAll = user.role === 'ADMIN' || (await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_APPROVALS, 'edit'))

  const approvals = await prisma.workflowApproval.findMany({
    where: { status: 'PENDING', ...(seesAll ? {} : { approverRole: user.role }) },
    include: {
      requestedBy: { select: { id: true, name: true } },
      stageRecord: {
        include: {
          stage: { select: { label: true } },
          session: { include: { outlet: { select: { name: true } }, template: { select: { name: true } } } },
        },
      },
      transaction: {
        include: {
          staff: { select: { name: true } },
          session: { include: { outlet: { select: { name: true } } } },
        },
      },
      // Universal Expense & Disbursement Framework bridge (M4) — surfaces
      // expense-request approvals in this same shared inbox, no separate
      // screen needed.
      expenseRequest: {
        select: { id: true, purpose: true, amount: true, currency: true, requestType: { select: { name: true } }, category: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(approvals)
}
