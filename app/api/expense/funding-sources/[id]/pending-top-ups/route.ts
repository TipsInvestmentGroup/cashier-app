import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { roundMoney } from '@/lib/utils'
import { isStageGrant } from '@/lib/expense-workflow'
import { hasGrant } from '@/lib/expense-grants'
import { fundClassOf } from '@/lib/expense-funds'

/**
 * GET — the top-up requests awaiting approval for one fund. Top-ups are
 * ExpenseRequests with direction=IN (see lib/expense-topup.ts), which the main
 * /api/expense/requests list deliberately hides (it filters direction=OUT). That
 * left a pending top-up reachable ONLY through its notification and its detail
 * URL — no list surfaced it. This endpoint is that list, the direction=IN
 * sibling of ready-to-pay: a per-fund queue an approver can browse instead of
 * hunting through notifications.
 *
 * Gating mirrors who can ACT, not a job-title list. Approving/rejecting an
 * expense request is gated by a per-fund/outlet GRANT (FIRST_APPROVER/
 * SECOND_APPROVER), not by User.role — see /api/expense/requests/[id]/decide and
 * the shared inbox /api/collection-approvals/[id]. So this list returns only the
 * rows the viewer can actually decide (each row's CURRENT pending stage grant,
 * checked with hasGrant for this fund's class + outlet). ADMIN and holders of an
 * explicit COLLECTION_APPROVALS grant see them all. Filtering here — rather than
 * gating the whole endpoint by a VIEWER_ROLES list — keeps the "Review →"
 * affordance honest: every row shown is one the viewer can complete, and a
 * non-approver simply gets an empty queue instead of buttons that 403.
 *
 * Scope: PENDING_APPROVAL only (the actionable set) and only requests that name
 * THIS fund, matching ready-to-pay's per-fund convention. Approve/Reject still
 * happens on the request detail page; this just makes the pending ones findable.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const source = await prisma.fundingSource.findUnique({
    where: { id },
    select: { id: true, sourceType: true, outletId: true },
  })
  if (!source) return NextResponse.json({ error: 'Funding source not found' }, { status: 404 })

  const pending = await prisma.expenseRequest.findMany({
    where: { fundingSourceId: id, direction: 'IN', status: 'PENDING_APPROVAL' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, purpose: true, amount: true, reference: true, currency: true, status: true, requestedById: true, createdAt: true, outletId: true },
  })

  const seesAll = user.role === 'ADMIN' || (await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_APPROVALS, 'edit'))

  let visible = pending
  if (!seesAll && pending.length) {
    // Each PENDING_APPROVAL request has exactly one open WorkflowApproval whose
    // approverRole is the current stage grant (openNextApprovalStep keeps one
    // open at a time). A row is visible only if the viewer holds that grant for
    // this fund's class + outlet — the same test the decide route enforces.
    const approvals = await prisma.workflowApproval.findMany({
      where: { expenseRequestId: { in: pending.map((p) => p.id) }, status: 'PENDING' },
      select: { expenseRequestId: true, approverRole: true },
    })
    const stageByRequest = new Map(approvals.map((a) => [a.expenseRequestId, a.approverRole]))
    const fundClass = fundClassOf(source.sourceType)

    const allowed = []
    for (const r of pending) {
      const approverRole = stageByRequest.get(r.id)
      if (!approverRole) continue
      // Scope the chain to the FUND's outlet when it has one, else the request's
      // (mirrors resolveApprovalPlan / the decide route).
      const outletId = source.outletId ?? r.outletId ?? null
      if (isStageGrant(approverRole)) {
        if (await hasGrant(user.userId, approverRole, { fundClass, outletId })) allowed.push(r)
      } else if (approverRole === user.role) {
        // Legacy rows whose approverRole is a User.role (predate the §4 grants).
        allowed.push(r)
      }
    }
    visible = allowed
  }

  // outletId was selected only to scope the grant check — project it away so the
  // response row shape stays exactly what the ledger page expects.
  const rows = visible.map((r) => ({
    id: r.id, purpose: r.purpose, amount: r.amount, reference: r.reference,
    currency: r.currency, status: r.status, requestedById: r.requestedById, createdAt: r.createdAt,
  }))

  return NextResponse.json({
    fundingSourceId: id,
    count: rows.length,
    totalPending: roundMoney(rows.reduce((s, r) => s + r.amount, 0)),
    rows,
  })
}
