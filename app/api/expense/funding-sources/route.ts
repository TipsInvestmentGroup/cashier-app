import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { FUNDING_SOURCE_TYPES, type FundingSourceType } from '@/lib/expense-config'
import { getFundingSourceBalance, writeFundingSourceTxn } from '@/lib/expense-ledger'
import { fundClassOf, allocationModeFor, supportsManualAllocation } from '@/lib/expense-funds'

// Same audience as PETTY_TABS/the Expense Requests screens — everyone who
// can reach the Pay action or just wants visibility, but not WAITER. This
// embeds CompanyPaymentAccount.accountName/bankName, so it must not be wider
// than lib/finance-access.ts's canViewFinance() + the disbursers who aren't
// finance roles (CASHIER) — never "any authenticated user".
const VIEWER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** GET — list funding sources (the Pay action needs this to render).
 *  Non-ADMIN only sees active ones. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!VIEWER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Archived rows are hidden from EVERY caller (admin included) — kept only so
  // historical payments stay readable, never re-selectable. ADMIN still sees
  // inactive-but-not-archived rows to manage them in Expense Settings.
  const sources = await prisma.fundingSource.findMany({
    where: user.role === 'ADMIN' ? { archived: false } : { isActive: true, archived: false },
    orderBy: [{ name: 'asc' }],
    include: { companyPaymentAccount: { select: { id: true, accountName: true, bankName: true } }, _count: { select: { payments: true } } },
  })
  // §5: available balance is COMPUTED per fund type, never a single stored
  // field — CASHIER_DRAWER follows the cashier's daily cash position,
  // BANK/MOBILE_MONEY/CARD follow their GL account, CASH/OTHER materialize.
  // Resolved here for every type (not just CASHIER_DRAWER as before) so callers
  // never have to know which types materialize and which don't, and so the
  // three fund screens all read one field.
  //
  // fundClass/allocationMode/supportsManualAllocation are derived, not stored
  // (lib/expense-funds.ts) — sent down so the UI can hide the controls that
  // don't apply to a fund without duplicating the mapping client-side.
  const enriched = await Promise.all(sources.map(async (s) => {
    const fundClass = fundClassOf(s.sourceType)
    return {
      ...s,
      availableBalance: await getFundingSourceBalance(prisma, s),
      fundClass,
      allocationMode: fundClass ? allocationModeFor(fundClass) : null,
      supportsManualAllocation: fundClass ? supportsManualAllocation(fundClass) : false,
    }
  }))
  return NextResponse.json(enriched)
}

/**
 * POST — create a funding source. sourceType=CASH/OTHER materializes its own
 * balance (openingBalance → currentBalance); BANK/MOBILE_MONEY/CARD requires
 * a companyPaymentAccountId and stores currentBalance=0 always, since that
 * type's balance is computed live from the wrapped CompanyPaymentAccount's GL
 * balance (see prisma/schema.prisma FundingSource doc + Stage 16 decision 2 in
 * docs/expense-disbursement-framework-design.md) — never a second stored
 * figure that could drift from the ledger.
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const code = String(body.code || name).trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_')
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const sourceType = body.sourceType !== undefined ? String(body.sourceType) : 'CASH'
  if (!(FUNDING_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    return NextResponse.json({ error: `sourceType must be one of ${FUNDING_SOURCE_TYPES.join(', ')}` }, { status: 400 })
  }
  const isAccountBacked = sourceType === 'BANK' || sourceType === 'MOBILE_MONEY' || sourceType === 'CARD'
  // CASHIER_DRAWER never materializes a balance either — it always reads live
  // from the assigned cashier's cash-recon position (Petty Cash Custodian
  // scenario A: no manual opening balance required).
  const isLiveBalance = isAccountBacked || sourceType === 'CASHIER_DRAWER'

  let companyPaymentAccountId: string | null = null
  if (isAccountBacked) {
    if (!body.companyPaymentAccountId) return NextResponse.json({ error: `${sourceType} funding sources require companyPaymentAccountId` }, { status: 400 })
    const account = await prisma.companyPaymentAccount.findUnique({ where: { id: String(body.companyPaymentAccountId) } })
    if (!account) return NextResponse.json({ error: 'companyPaymentAccountId does not reference a known payment account' }, { status: 400 })
    companyPaymentAccountId = account.id
  }

  const companyId = await resolveDefaultCompanyId(prisma)
  if (!companyId) return NextResponse.json({ error: 'No company configured' }, { status: 400 })

  const dupe = await prisma.fundingSource.findUnique({ where: { companyId_code: { companyId, code } } })
  if (dupe) return NextResponse.json({ error: `A funding source with code ${code} already exists` }, { status: 409 })

  const openingBalance = !isLiveBalance && Number(body.openingBalance) > 0 ? Number(body.openingBalance) : 0

  const source = await prisma.fundingSource.create({
    data: {
      companyId,
      code,
      name,
      sourceType: sourceType as FundingSourceType,
      companyPaymentAccountId,
      outletId: body.outletId ? String(body.outletId) : null,
      openingBalance,
      currentBalance: isLiveBalance ? 0 : openingBalance,
      dailyLimit: Number(body.dailyLimit) > 0 ? Number(body.dailyLimit) : 0,
      responsibleUserId: body.responsibleUserId ? String(body.responsibleUserId) : null,
      currency: body.currency ? String(body.currency) : 'TZS',
      isActive: true,
    },
  })
  if (sourceType === 'CASH' && openingBalance > 0) {
    await writeFundingSourceTxn(prisma, {
      fundingSourceId: source.id, type: 'OPEN', amount: openingBalance, note: 'Opening balance',
      createdById: user.userId, createdByName: user.name,
    })
  }
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'FundingSource', entityId: source.id, details: `Created funding source ${name} (${code})` },
  })
  return NextResponse.json(source, { status: 201 })
}
