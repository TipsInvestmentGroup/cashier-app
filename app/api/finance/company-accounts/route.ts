import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance, canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId, ensureChartOfAccounts } from '@/lib/finance-mapping'
import { setDefaultCompanyPaymentAccount } from '@/lib/finance-banking'

/** List Company Payment Accounts (the real bank/mobile-money/cash accounts
 *  under each Payment Channel "type"). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json([])

  const accounts = await prisma.companyPaymentAccount.findMany({
    where: { companyId },
    include: { paymentChannel: true, outlet: { select: { name: true } }, glAccount: true },
    orderBy: [{ paymentChannelId: 'asc' }, { isDefault: 'desc' }, { accountName: 'asc' }],
  })
  return NextResponse.json(accounts)
}

/** Add a Company Payment Account. Its own dedicated GL account is created
 *  automatically (named after the account) so its balance is just that
 *  account's ledger balance — no separate balance column to keep in sync. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_BANKING))) {
    return NextResponse.json({ error: 'You are not authorized to manage company payment accounts' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { paymentChannelId, accountName, bankName, accountNumber, currency, outletId, isDefault } = body
  if (!paymentChannelId || !accountName?.trim()) return NextResponse.json({ error: 'paymentChannelId and accountName are required' }, { status: 400 })
  const companyId = body.companyId || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })

  await ensureChartOfAccounts(prisma, companyId)

  try {
    const account = await prisma.$transaction(async (tx) => {
      // A dedicated ASSET account per company payment account — code derived
      // from a running counter so it never collides with the seeded chart.
      const seq = (await tx.account.count({ where: { companyId, code: { startsWith: '19' } } })) + 1
      const glAccount = await tx.account.create({
        data: { companyId, code: `19${String(seq).padStart(2, '0')}`, name: `${accountName.trim()} (Bank/Cash)`, type: 'ASSET' },
      })
      const created = await tx.companyPaymentAccount.create({
        data: {
          companyId, paymentChannelId, accountName: accountName.trim(), bankName: bankName || null, accountNumber: accountNumber || null,
          currency: currency || 'TZS', outletId: outletId || null, glAccountId: glAccount.id, isDefault: false,
        },
      })
      return created
    })
    if (isDefault) await setDefaultCompanyPaymentAccount(account.id)

    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'CompanyPaymentAccount', entityId: account.id, details: `Added account ${account.accountName}` } })
    return NextResponse.json(account, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create the account' }, { status: 400 })
  }
}
