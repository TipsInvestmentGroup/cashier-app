import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance } from '@/lib/finance-access'
import { tenantCompanyId } from '@/lib/tenant'
import { trialBalance } from '@/lib/finance-statements'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = await tenantCompanyId(user, searchParams.get('companyId'))
  if (!companyId) return NextResponse.json({ rows: [], totalDebit: 0, totalCredit: 0 })
  const asOfDate = searchParams.get('asOfDate') ? new Date(searchParams.get('asOfDate')!) : new Date()

  return NextResponse.json(await trialBalance(companyId, asOfDate))
}
