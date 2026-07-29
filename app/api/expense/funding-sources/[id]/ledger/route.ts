import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { listFundingSourceLedger, getFundingSourceBalance } from '@/lib/expense-ledger'

const VIEWER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** GET — the Petty Cash Ledger for one funding source: opening/received/paid/
 *  closing summary + the full transaction history. For CASHIER_DRAWER/BANK/
 *  MOBILE_MONEY/CARD sources (whose balance is always read live, never
 *  accumulated from FundingSourceTxn rows), returns the live balance as
 *  `closingBalance` alongside whatever PAYMENT audit rows exist. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!VIEWER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const source = await prisma.fundingSource.findUnique({ where: { id } })
  if (!source) return NextResponse.json({ error: 'Funding source not found' }, { status: 404 })

  if (source.sourceType === 'CASH' || source.sourceType === 'OTHER') {
    return NextResponse.json(await listFundingSourceLedger(id))
  }

  const liveBalance = await getFundingSourceBalance(prisma, source)
  const rows = await prisma.fundingSourceTxn.findMany({ where: { fundingSourceId: id }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json({
    fundingSourceId: id,
    openingBalance: source.sourceType === 'CASHIER_DRAWER' ? liveBalance : 0,
    totalReceived: 0,
    totalPaid: rows.filter((r) => r.amount < 0).reduce((s, r) => s + -r.amount, 0),
    closingBalance: liveBalance,
    rows,
    live: true,
  })
}
