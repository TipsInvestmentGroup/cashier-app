import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance, canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { createReconciliation } from '@/lib/finance-reconciliation'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json([])

  const reconciliations = await prisma.accountReconciliation.findMany({
    where: { companyPaymentAccount: { companyId } },
    include: { companyPaymentAccount: true, items: true },
    orderBy: { periodStart: 'desc' },
    take: 100,
  })
  return NextResponse.json(reconciliations)
}

/** Start a new reconciliation — snapshots GL activity for the period and
 *  runs the auto-matcher immediately against the given statement lines. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_RECONCILIATION))) {
    return NextResponse.json({ error: 'You are not authorized to manage reconciliations' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { companyPaymentAccountId, periodStart, periodEnd, statementBalance, statementLines } = body
  if (!companyPaymentAccountId || !periodStart || !periodEnd || statementBalance === undefined) {
    return NextResponse.json({ error: 'companyPaymentAccountId, periodStart, periodEnd and statementBalance are required' }, { status: 400 })
  }
  if (!Array.isArray(statementLines)) return NextResponse.json({ error: 'statementLines must be an array' }, { status: 400 })

  const parsedPeriodStart = new Date(periodStart)
  const parsedPeriodEnd = new Date(periodEnd)
  if (Number.isNaN(parsedPeriodStart.getTime()) || Number.isNaN(parsedPeriodEnd.getTime())) {
    return NextResponse.json({ error: 'periodStart/periodEnd must be valid dates' }, { status: 400 })
  }
  if (parsedPeriodStart > parsedPeriodEnd) return NextResponse.json({ error: 'periodStart must not be after periodEnd' }, { status: 400 })
  if (!Number.isFinite(Number(statementBalance))) return NextResponse.json({ error: 'statementBalance must be a number' }, { status: 400 })

  const parsedLines: { transactionDate: Date; description: string | null; amount: number }[] = []
  for (const [i, l] of statementLines.entries()) {
    const date = new Date(l?.transactionDate)
    const amount = Number(l?.amount)
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: `Statement line ${i + 1} has an invalid date` }, { status: 400 })
    if (!Number.isFinite(amount) || amount === 0) return NextResponse.json({ error: `Statement line ${i + 1} needs a non-zero numeric amount` }, { status: 400 })
    parsedLines.push({ transactionDate: date, description: l?.description || null, amount })
  }

  try {
    const rec = await createReconciliation({
      companyPaymentAccountId, periodStart: parsedPeriodStart, periodEnd: parsedPeriodEnd,
      statementBalance: Number(statementBalance),
      statementLines: parsedLines,
      createdById: user.userId,
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'AccountReconciliation', entityId: rec.id, details: `Started reconciliation for account ${companyPaymentAccountId}` } })
    return NextResponse.json(rec, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create the reconciliation' }, { status: 400 })
  }
}
