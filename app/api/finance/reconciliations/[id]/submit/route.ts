import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { submitReconciliation } from '@/lib/finance-reconciliation'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_RECONCILIATION))) {
    return NextResponse.json({ error: 'You are not authorized to submit reconciliations' }, { status: 403 })
  }

  try {
    await submitReconciliation(id, user.userId)
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'AccountReconciliation', entityId: id, details: 'Submitted for approval' } })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not submit this reconciliation' }, { status: 400 })
  }
}
