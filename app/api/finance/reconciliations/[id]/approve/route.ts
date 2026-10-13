import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { tenantCompanyId } from '@/lib/tenant'
import { approveReconciliation } from '@/lib/finance-reconciliation'
import { isOwnerEmail } from '@/lib/owner'

const APPROVER_ROLES = ['DIRECTOR', 'ADMIN']

/** Finalizes a reconciliation — DIRECTOR/ADMIN only, and never the same
 *  person who submitted it (see lib/finance-reconciliation.ts approveReconciliation). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!APPROVER_ROLES.includes(user.role) && !isOwnerEmail(user.email)) {
    return NextResponse.json({ error: 'Only a Director or Admin can approve a reconciliation' }, { status: 403 })
  }

  const companyId = await tenantCompanyId(user)
  const rec = await prisma.accountReconciliation.findUnique({ where: { id }, select: { companyPaymentAccount: { select: { companyId: true } } } })
  if (!rec || !companyId || rec.companyPaymentAccount.companyId !== companyId) return NextResponse.json({ error: 'Reconciliation not found' }, { status: 404 })

  try {
    await approveReconciliation(id, user.userId)
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'AccountReconciliation', entityId: id, details: 'Approved' } })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not approve this reconciliation' }, { status: 400 })
  }
}
