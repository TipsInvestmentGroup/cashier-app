import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance, canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { setAccountMapping, MAPPING_SCOPES } from '@/lib/finance-mapping'
import { tenantCompanyId, outletInCompany } from '@/lib/tenant'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = await tenantCompanyId(user, searchParams.get('companyId'))
  if (!companyId) return NextResponse.json([])
  // Only honour an outlet filter for an outlet of this company.
  const requestedOutletId = searchParams.get('outletId')
  const outletId = requestedOutletId && (await outletInCompany(prisma, requestedOutletId, companyId)) ? requestedOutletId : null

  const mappings = await prisma.financeAccountMapping.findMany({
    where: { OR: [{ scope: 'COMPANY', scopeId: companyId }, ...(outletId ? [{ scope: 'OUTLET', scopeId: outletId }] : [])] },
    include: { account: true },
  })
  return NextResponse.json(mappings)
}

/** Set/override the account for one mapping key at COMPANY or OUTLET scope. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_ACCOUNTS))) {
    return NextResponse.json({ error: 'You are not authorized to manage account mappings' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { scope, scopeId, key, accountId } = body
  if (!MAPPING_SCOPES.includes(scope) || scope === 'GLOBAL') return NextResponse.json({ error: 'scope must be COMPANY or OUTLET' }, { status: 400 })
  if (!scopeId || !key || !accountId) return NextResponse.json({ error: 'scopeId, key and accountId are required' }, { status: 400 })

  const companyId = await tenantCompanyId(user)
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })
  // The scope target must be this company, or one of its outlets.
  if (scope === 'COMPANY' ? scopeId !== companyId : !(await outletInCompany(prisma, String(scopeId), companyId))) {
    return NextResponse.json({ error: 'Scope does not belong to your company' }, { status: 400 })
  }
  const acct = await prisma.account.findUnique({ where: { id: String(accountId) }, select: { companyId: true } })
  if (!acct || acct.companyId !== companyId) return NextResponse.json({ error: 'Account does not belong to your company' }, { status: 400 })

  const mapping = await setAccountMapping(scope, scopeId, key, accountId)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPSERT', entity: 'FinanceAccountMapping', entityId: mapping.id, details: `${scope}:${scopeId} ${key} -> ${accountId}` } })
  return NextResponse.json(mapping)
}
