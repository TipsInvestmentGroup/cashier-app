import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance, canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { ensureChartOfAccounts, resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { ACCOUNT_TYPES } from '@/lib/ledger'

/** List the Chart of Accounts for a company (seeds the default set on first read). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json([])

  await ensureChartOfAccounts(prisma, companyId)
  const accounts = await prisma.account.findMany({ where: { companyId }, orderBy: [{ type: 'asc' }, { code: 'asc' }] })
  return NextResponse.json(accounts)
}

/** Add an account to a company's Chart of Accounts. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_ACCOUNTS))) {
    return NextResponse.json({ error: 'You are not authorized to manage the Chart of Accounts' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { code, name, type, parentId } = body
  const companyId = body.companyId || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })
  if (!code || !String(code).trim()) return NextResponse.json({ error: 'Account code is required' }, { status: 400 })
  if (!name || !String(name).trim()) return NextResponse.json({ error: 'Account name is required' }, { status: 400 })
  if (!ACCOUNT_TYPES.includes(type)) return NextResponse.json({ error: 'Invalid account type' }, { status: 400 })

  try {
    const account = await prisma.account.create({
      data: { companyId, code: String(code).trim(), name: String(name).trim(), type, parentId: parentId || null },
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'Account', entityId: account.id, details: `Added account ${account.code} ${account.name}` } })
    return NextResponse.json(account, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'An account with that code already exists for this company' }, { status: 409 })
  }
}
