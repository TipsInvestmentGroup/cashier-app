import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { generateFinancialYearPeriods } from '@/lib/finance-periods'

/** "Financial Year Management" — generates the standard 1 ANNUAL + 4
 *  QUARTERLY + 12 MONTHLY period set for a company in one action. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_PERIODS))) {
    return NextResponse.json({ error: 'You are not authorized to manage financial periods' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!body.yearStartDate) return NextResponse.json({ error: 'yearStartDate is required' }, { status: 400 })
  const companyId = body.companyId || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })

  const result = await generateFinancialYearPeriods(companyId, new Date(body.yearStartDate))
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'FinancialPeriod', entityId: companyId, details: `Generated financial year from ${body.yearStartDate} (${result.created} created, ${result.skipped} already existed)` } })
  return NextResponse.json(result, { status: 201 })
}
