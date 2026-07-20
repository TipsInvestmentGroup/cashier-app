import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'
import { getOrCreateBusinessDay } from '@/lib/business-day'
import { notifyResourceHolders } from '@/lib/notifications'
import { startOfDay } from 'date-fns'

/** GET — list unlock requests (approver queue + "my requests"). Filters: status, outletId, requestedById. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.VIEW_BUSINESS_DAYS))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const requestedById = searchParams.get('requestedById')
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)

  if (outletId === NO_OUTLET) return NextResponse.json({ requests: [] })

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (requestedById) where.requestedById = requestedById
  if (outletId) where.businessDay = { outletId }

  const requests = await prisma.businessDayUnlockRequest.findMany({
    where,
    include: {
      businessDay: { select: { id: true, date: true, status: true, outlet: { select: { id: true, name: true } } } },
      requestedBy: { select: { name: true, role: true } },
      approver: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })

  return NextResponse.json({ requests })
}

/** POST — create an unlock request (non-management path). Body: { outletId, date, reason, requestedDuration, requestedMinutes?, scopeShift?, scopeCounter? }. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.VIEW_BUSINESS_DAYS))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const outletId = user.role === 'CASHIER' ? (user.outletId || body.outletId) : (body.outletId || user.outletId)
  if (!outletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })
  if (!body.reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 })
  if (!body.date) return NextResponse.json({ error: 'date is required' }, { status: 400 })

  const date = startOfDay(new Date(body.date))
  const bd = await getOrCreateBusinessDay(outletId, date)

  const request = await prisma.businessDayUnlockRequest.create({
    data: {
      businessDayId: bd.id,
      requestedById: user.userId,
      reason: body.reason,
      scopeShift: body.scopeShift || null,
      scopeCounter: body.scopeCounter || null,
      requestedDuration: body.requestedDuration || '30m',
      requestedMinutes: body.requestedMinutes || null,
    },
  })

  await prisma.businessDayAuditLog.create({
    data: { businessDayId: bd.id, action: 'UNLOCK_REQUESTED', reason: body.reason, userId: user.userId, userName: user.name || user.email || 'Unknown' },
  })

  await notifyResourceHolders(BUSINESS_DAY_RESOURCES.APPROVE_UNLOCK, outletId, {
    type: 'UNLOCK_REQUESTED',
    title: 'Unlock requested',
    message: `${user.name} requested to unlock ${date.toISOString().slice(0, 10)}: ${body.reason}`,
    entityType: 'BusinessDayUnlockRequest',
    entityId: request.id,
  })

  return NextResponse.json({ ok: true, request })
}
