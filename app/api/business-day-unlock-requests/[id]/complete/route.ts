import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'
import { closeBusinessDay } from '@/lib/business-day'

/** POST — the requester (or a management close-holder) confirms missing records have
 *  been submitted; re-runs missing-data detection and re-closes the day immediately
 *  rather than waiting for the unlock window to expire. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const request = await prisma.businessDayUnlockRequest.findUnique({ where: { id }, include: { businessDay: true } })
  if (!request) return NextResponse.json({ error: 'Unlock request not found' }, { status: 404 })
  if (request.status !== 'APPROVED') return NextResponse.json({ error: 'Only an approved request can be completed' }, { status: 409 })

  const isRequester = request.requestedById === user.userId
  const canCloseForOthers = await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.CLOSE_BUSINESS_DAY)
  if (!isRequester && !canCloseForOthers) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }

  const result = await closeBusinessDay({
    outletId: request.businessDay.outletId,
    date: request.businessDay.date,
    actor,
    allowIncomplete: !!body.allowIncomplete,
  })
  if (result.blocked) {
    return NextResponse.json({ error: 'Still missing data — cannot re-close yet', missingItems: result.missingItems }, { status: 400 })
  }

  const updated = await prisma.businessDayUnlockRequest.update({
    where: { id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  })

  return NextResponse.json({ ok: true, request: updated })
}
