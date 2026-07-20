import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'
import { autoLockExpiredBusinessDays } from '@/lib/business-day'

/** GET — Business Day Dashboard list. Filters: outletId, from, to, status, responsibleUserId. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.VIEW_BUSINESS_DAYS))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)
  const status = searchParams.get('status')
  const responsibleUserId = searchParams.get('responsibleUserId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (outletId === NO_OUTLET) return NextResponse.json({ businessDays: [] })

  await autoLockExpiredBusinessDays({ outletId })

  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId
  if (status) where.status = status
  if (from || to) where.date = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) }
  if (responsibleUserId) where.OR = [{ closedById: responsibleUserId }, { reopenedById: responsibleUserId }]

  const businessDays = await prisma.businessDay.findMany({
    where,
    include: { outlet: { select: { id: true, name: true } } },
    orderBy: { date: 'desc' },
    take: 500,
  })

  return NextResponse.json({
    businessDays: businessDays.map((bd) => ({
      id: bd.id,
      date: bd.date,
      outlet: bd.outlet,
      status: bd.status,
      isComplete: bd.isComplete,
      missingItems: bd.missingItems ? JSON.parse(bd.missingItems) : [],
      closedByName: bd.closedByName,
      reopenedByName: bd.reopenedByName,
      reopenReason: bd.reopenReason,
      lockExpiresAt: bd.lockExpiresAt,
    })),
  })
}
