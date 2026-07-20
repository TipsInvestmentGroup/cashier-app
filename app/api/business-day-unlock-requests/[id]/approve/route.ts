import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'
import { reopenBusinessDay, resolveDurationMinutes } from '@/lib/business-day'
import { createNotification } from '@/lib/notifications'

/** POST — approve a pending unlock request: reopens the business day and notifies the requester. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.APPROVE_UNLOCK))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const request = await prisma.businessDayUnlockRequest.findUnique({ where: { id }, include: { businessDay: true } })
  if (!request) return NextResponse.json({ error: 'Unlock request not found' }, { status: 404 })
  if (request.status !== 'PENDING') return NextResponse.json({ error: 'This request has already been resolved' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }
  const durationMinutes = resolveDurationMinutes(request.requestedDuration, request.requestedMinutes)

  await reopenBusinessDay({
    outletId: request.businessDay.outletId,
    date: request.businessDay.date,
    actor,
    reason: request.reason,
    durationMinutes,
  })

  const updated = await prisma.businessDayUnlockRequest.update({
    where: { id },
    data: { status: 'APPROVED', approverId: user.userId, approverComment: body.comment || null, resolvedAt: new Date() },
  })

  await prisma.businessDayAuditLog.create({
    data: {
      businessDayId: request.businessDayId,
      action: 'UNLOCK_APPROVED',
      reason: body.comment || null,
      approvedById: user.userId,
      approvedByName: actor.userName,
      userId: request.requestedById,
    },
  })

  await createNotification({
    userId: request.requestedById,
    type: 'UNLOCK_APPROVED',
    title: 'Unlock request approved',
    message: `Your unlock request for ${request.businessDay.date.toISOString().slice(0, 10)} was approved by ${actor.userName}.`,
    entityType: 'BusinessDayUnlockRequest',
    entityId: id,
  })

  return NextResponse.json({ ok: true, request: updated })
}
