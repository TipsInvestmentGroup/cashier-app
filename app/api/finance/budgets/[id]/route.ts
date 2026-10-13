import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { tenantCompanyId } from '@/lib/tenant'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_BUDGETS))) {
    return NextResponse.json({ error: 'You are not authorized to manage budgets' }, { status: 403 })
  }

  const budget = await prisma.budget.findUnique({ where: { id }, select: { companyId: true } })
  if (!budget || budget.companyId !== (await tenantCompanyId(user))) return NextResponse.json({ error: 'Budget not found' }, { status: 404 })

  await prisma.budget.delete({ where: { id } }).catch(() => null)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'Budget', entityId: id, details: 'Deleted budget' } })
  return NextResponse.json({ ok: true })
}
