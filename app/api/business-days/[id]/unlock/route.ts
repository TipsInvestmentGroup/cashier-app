import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'
import { reopenBusinessDay, resolveDurationMinutes } from '@/lib/business-day'

/** POST — direct unlock/reopen by a management-permission holder.
 *  Body: { reason, durationMinutes: "15m"|"30m"|"1h"|"CUSTOM", customMinutes?, scopeShift?, scopeCounter? }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.UNLOCK_BUSINESS_DAY))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const bd = await prisma.businessDay.findUnique({ where: { id } })
  if (!bd) return NextResponse.json({ error: 'Business day not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 })

  const durationMinutes = body.durationMinutes ? resolveDurationMinutes(body.durationMinutes, body.customMinutes) : null
  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }

  const updated = await reopenBusinessDay({ outletId: bd.outletId, date: bd.date, actor, reason: body.reason, durationMinutes })
  return NextResponse.json({ ok: true, businessDay: updated })
}
