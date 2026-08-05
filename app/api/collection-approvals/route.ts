import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { isStageGrant } from '@/lib/expense-workflow'
import { hasGrant } from '@/lib/expense-grants'
import { fundClassOf } from '@/lib/expense-funds'

/**
 * List pending WorkflowApprovals. A user sees approvals addressed to their
 * own role, plus ADMIN/anyone with an explicit COLLECTION_APPROVALS grant
 * sees everything (mirrors the owner/grant pattern used across the app).
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const seesAll = user.role === 'ADMIN' || (await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_APPROVALS, 'edit'))

  // Expense approvals are addressed to a GRANT (FIRST_APPROVER/SECOND_APPROVER
  // for a fund + outlet), not to a job title, so they cannot be filtered by
  // approverRole in SQL. Fetch them alongside the role-matched rows and narrow
  // them by grant below. Pending approvals are a small working set, so the
  // extra rows cost little.
  const approvals = await prisma.workflowApproval.findMany({
    where: {
      status: 'PENDING',
      ...(seesAll ? {} : { OR: [{ approverRole: user.role }, { expenseRequestId: { not: null } }] }),
    },
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
        select: {
          id: true, purpose: true, amount: true, currency: true, outletId: true, direction: true,
          requestType: { select: { name: true } }, category: { select: { name: true } },
          fundingSource: { select: { id: true, name: true, sourceType: true, outletId: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  if (seesAll) return NextResponse.json(approvals)

  // Narrow the expense rows to the ones this user actually holds the grant for.
  // Rows whose approverRole is a User.role rather than a stage grant predate the
  // §4 access layer — keep matching those by role so nothing already pending
  // vanishes from someone's inbox on deploy.
  const visible = []
  for (const a of approvals) {
    if (!a.expenseRequestId) { visible.push(a); continue }
    if (!isStageGrant(a.approverRole)) {
      if (a.approverRole === user.role) visible.push(a)
      continue
    }
    const source = a.expenseRequest?.fundingSource
    const fundClass = source ? fundClassOf(source.sourceType) : null
    const outletId = source?.outletId ?? a.expenseRequest?.outletId ?? null
    if (await hasGrant(user.userId, a.approverRole, { fundClass, outletId })) visible.push(a)
  }
  return NextResponse.json(visible)
}
