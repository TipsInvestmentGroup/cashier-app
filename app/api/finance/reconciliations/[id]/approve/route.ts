import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { approveReconciliation } from '@/lib/finance-reconciliation'

const APPROVER_ROLES = ['DIRECTOR', 'ADMIN']

/** Finalizes a reconciliation — DIRECTOR/ADMIN only, and never the same
 *  person who submitted it (see lib/finance-reconciliation.ts approveReconciliation). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const isOwner = !!process.env.NEXT_PUBLIC_OWNER_EMAIL && user.email?.toLowerCase() === process.env.NEXT_PUBLIC_OWNER_EMAIL.toLowerCase()
  if (!APPROVER_ROLES.includes(user.role) && !isOwner) {
    return NextResponse.json({ error: 'Only a Director or Admin can approve a reconciliation' }, { status: 403 })
  }

  try {
    await approveReconciliation(id, user.userId)
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'AccountReconciliation', entityId: id, details: 'Approved' } })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not approve this reconciliation' }, { status: 400 })
  }
}
