import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance, canManageFinance } from '@/lib/finance-access'
import { RESOURCES, isOwner } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json([])

  const periods = await prisma.financialPeriod.findMany({ where: { companyId }, orderBy: { startDate: 'desc' } })
  return NextResponse.json(periods)
}

const REOPEN_ROLES = ['DIRECTOR', 'ADMIN']

/** Create a period, or lock/reopen an existing one (pass `id` + `status`).
 *  Reopening a LOCKED period ("Reopen with Authorization") is restricted to
 *  DIRECTOR/ADMIN — a higher bar than the ACCOUNTANT-level access that can
 *  lock one or create new periods — and records the reason given. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_PERIODS))) {
    return NextResponse.json({ error: 'You are not authorized to manage financial periods' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))

  if (body.id && body.status) {
    if (!['OPEN', 'LOCKED'].includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    if (body.status === 'OPEN' && !REOPEN_ROLES.includes(user.role) && !isOwner(user.email)) {
      return NextResponse.json({ error: 'Only a Director or Admin can reopen a locked period' }, { status: 403 })
    }
    const updated = await prisma.financialPeriod.update({
      where: { id: body.id },
      data: {
        status: body.status,
        lockedAt: body.status === 'LOCKED' ? new Date() : null,
        lockedById: body.status === 'LOCKED' ? user.userId : null,
        reopenReason: body.status === 'OPEN' ? (body.reason || null) : null,
      },
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'FinancialPeriod', entityId: body.id, details: `Set to ${body.status}${body.reason ? ` — ${body.reason}` : ''}` } })
    return NextResponse.json(updated)
  }

  const companyId = body.companyId || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })
  if (!body.name || !body.startDate || !body.endDate) return NextResponse.json({ error: 'name, startDate and endDate are required' }, { status: 400 })

  try {
    const period = await prisma.financialPeriod.create({
      data: { companyId, name: body.name, periodType: body.periodType || 'MONTHLY', startDate: new Date(body.startDate), endDate: new Date(body.endDate) },
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'FinancialPeriod', entityId: period.id, details: `Created period ${period.name}` } })
    return NextResponse.json(period, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A period with that name already exists for this company' }, { status: 409 })
  }
}
