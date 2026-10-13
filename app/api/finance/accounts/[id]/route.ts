import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { fieldDiff } from '@/lib/utils'
import { tenantCompanyId } from '@/lib/tenant'

/** Edit / disable / archive an account. isSystemAccount rows can be renamed
 *  but not deactivated or reparented — they're what FinanceAccountMapping
 *  falls back to when nothing is configured. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_ACCOUNTS))) {
    return NextResponse.json({ error: 'You are not authorized to manage the Chart of Accounts' }, { status: 403 })
  }

  const account = await prisma.account.findUnique({ where: { id } })
  if (!account || account.companyId !== (await tenantCompanyId(user))) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim()
  if (typeof body.sortOrder === 'number') data.sortOrder = body.sortOrder
  if (typeof body.isActive === 'boolean') {
    if (account.isSystemAccount && !body.isActive) return NextResponse.json({ error: 'A system account cannot be deactivated' }, { status: 400 })
    data.isActive = body.isActive
  }
  if ('parentId' in body && !account.isSystemAccount) {
    if (body.parentId) {
      const parent = await prisma.account.findUnique({ where: { id: String(body.parentId) }, select: { companyId: true } })
      if (!parent || parent.companyId !== account.companyId) return NextResponse.json({ error: 'Parent account does not belong to your company' }, { status: 400 })
    }
    data.parentId = body.parentId || null
  }

  const updated = await prisma.account.update({ where: { id }, data })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'Account', entityId: id, details: `Updated account ${updated.code}: ${fieldDiff(account, data)}` } })
  return NextResponse.json(updated)
}
