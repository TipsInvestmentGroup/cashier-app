import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance, canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { budgetVsActual } from '@/lib/finance-budget'

/** List budgets with their computed Actual / Variance / Variance% / Forecast. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json([])
  const outletId = searchParams.get('outletId')

  const budgets = await prisma.budget.findMany({
    where: { companyId, ...(outletId ? { outletId } : {}) },
    include: { account: true, outlet: { select: { name: true } }, department: true, event: { select: { name: true } } },
    orderBy: { periodStart: 'desc' },
    take: 200,
  })

  const withActuals = await Promise.all(budgets.map(async (b) => ({ ...b, ...(await budgetVsActual(b.id)) })))
  return NextResponse.json(withActuals)
}

/** Add a budget line — one GL Account over one period, optionally scoped
 *  to an outlet, and tagged with a department/event for organization. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_BUDGETS))) {
    return NextResponse.json({ error: 'You are not authorized to manage budgets' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { accountId, outletId, departmentId, eventId, periodType, periodStart, periodEnd, amount, note } = body
  if (!accountId || !periodStart || !periodEnd || !(Number(amount) > 0)) {
    return NextResponse.json({ error: 'accountId, periodStart, periodEnd and a positive amount are required' }, { status: 400 })
  }
  const parsedStart = new Date(periodStart)
  const parsedEnd = new Date(periodEnd)
  if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) {
    return NextResponse.json({ error: 'periodStart/periodEnd must be valid dates' }, { status: 400 })
  }
  if (parsedStart > parsedEnd) return NextResponse.json({ error: 'periodStart must not be after periodEnd' }, { status: 400 })
  const companyId = body.companyId || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })

  const budget = await prisma.budget.create({
    data: {
      companyId, accountId, outletId: outletId || null, departmentId: departmentId || null, eventId: eventId || null,
      periodType: periodType || 'MONTHLY', periodStart: parsedStart, periodEnd: parsedEnd,
      amount: Number(amount), note: note || null, createdById: user.userId,
    },
  })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'Budget', entityId: budget.id, details: `Budget of ${amount} for account ${accountId}` } })
  return NextResponse.json(budget, { status: 201 })
}
