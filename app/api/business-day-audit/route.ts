import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'

/** GET — read-only, immutable Business Day audit trail. No write verbs are ever
 *  added for this route; audit rows are insert-only (see lib/business-day.ts). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.VIEW_BUSINESS_DAY_AUDIT_LOG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)
  const businessDayId = searchParams.get('businessDayId')
  const action = searchParams.get('action')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (outletId === NO_OUTLET) return NextResponse.json({ logs: [] })

  const where: Record<string, unknown> = {}
  if (businessDayId) where.businessDayId = businessDayId
  if (action) where.action = action
  if (outletId || from || to) {
    where.businessDay = {
      ...(outletId ? { outletId } : {}),
      ...(from || to ? { date: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    }
  }

  const logs = await prisma.businessDayAuditLog.findMany({
    where,
    include: { businessDay: { select: { date: true, outlet: { select: { name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  return NextResponse.json({ logs })
}
