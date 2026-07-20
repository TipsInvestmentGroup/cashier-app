import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance } from '@/lib/finance-access'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { incomeStatement } from '@/lib/finance-statements'
import { startOfMonth, endOfMonth } from 'date-fns'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ revenue: [], expenses: [], totalRevenue: 0, totalExpenses: 0, netProfit: 0 })
  const now = new Date()
  const periodStart = searchParams.get('periodStart') ? new Date(searchParams.get('periodStart')!) : startOfMonth(now)
  const periodEnd = searchParams.get('periodEnd') ? new Date(searchParams.get('periodEnd')!) : endOfMonth(now)

  return NextResponse.json(await incomeStatement(companyId, periodStart, periodEnd))
}
