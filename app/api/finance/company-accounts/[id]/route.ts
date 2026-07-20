import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageFinance, canViewFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { setDefaultCompanyPaymentAccount, companyAccountBalance } from '@/lib/finance-banking'
import { fieldDiff } from '@/lib/utils'

/** Edit / activate-deactivate / set-as-default a Company Payment Account. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_BANKING))) {
    return NextResponse.json({ error: 'You are not authorized to manage company payment accounts' }, { status: 403 })
  }

  const account = await prisma.companyPaymentAccount.findUnique({ where: { id } })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (body.isDefault === true) await setDefaultCompanyPaymentAccount(id)

  const data: Record<string, unknown> = {}
  if (typeof body.accountName === 'string' && body.accountName.trim()) data.accountName = body.accountName.trim()
  if ('bankName' in body) data.bankName = body.bankName || null
  if ('accountNumber' in body) data.accountNumber = body.accountNumber || null
  if (typeof body.currency === 'string') data.currency = body.currency
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (body.isDefault === true) data.isDefault = true

  const updated = Object.keys(data).length ? await prisma.companyPaymentAccount.update({ where: { id }, data }) : account
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'CompanyPaymentAccount', entityId: id, details: `Updated account ${updated.accountName}: ${fieldDiff(account, data)}` } })
  return NextResponse.json(await prisma.companyPaymentAccount.findUnique({ where: { id }, include: { paymentChannel: true, outlet: { select: { name: true } }, glAccount: true } }))
}

/** Current balance — the linked GL account's ledger balance. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const balance = await companyAccountBalance(prisma, id)
  return NextResponse.json({ balance })
}
