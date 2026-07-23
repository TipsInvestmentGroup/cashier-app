import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { decideExpenseRequest } from '@/lib/expense-requests'

const FALLBACK_APPROVER_ROLES = ['MANAGER', 'ADMIN']

function parseRoleList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * POST — approve or reject a PENDING_APPROVAL request. Body: { approve:
 * boolean, comment?: string }. Role-gated against the request type's
 * approverRoles (falling back to MANAGER/ADMIN when none configured); ADMIN
 * always passes. This is Phase 1 (M3): a direct role check, not yet a
 * materialized WorkflowApproval row — see lib/expense-requests.ts
 * decideExpenseRequest's doc comment for what M4 adds on top.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.expenseRequest.findUnique({ where: { id }, include: { requestType: { select: { approverRoles: true } } } })
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const allowedRoles = parseRoleList(existing.requestType.approverRoles)
  const effectiveRoles = allowedRoles.length ? allowedRoles : FALLBACK_APPROVER_ROLES
  if (user.role !== 'ADMIN' && !effectiveRoles.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (typeof body.approve !== 'boolean') return NextResponse.json({ error: 'approve (boolean) is required' }, { status: 400 })

  try {
    const result = await decideExpenseRequest(prisma, id, { approve: body.approve })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseRequest', entityId: id, details: `${body.approve ? 'Approved' : 'Rejected'} expense request${body.comment ? `: ${body.comment}` : ''}` },
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to decide request' }, { status: 400 })
  }
}
