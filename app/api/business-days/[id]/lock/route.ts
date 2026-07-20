import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'
import { lockBusinessDay } from '@/lib/business-day'

/** POST — manually re-lock a REOPENED day before its unlock window expires. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const allowed = (await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.UNLOCK_BUSINESS_DAY))
    || (await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.CLOSE_BUSINESS_DAY))
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }
  try {
    const updated = await lockBusinessDay({ businessDayId: id, actor })
    return NextResponse.json({ ok: true, businessDay: updated })
  } catch {
    return NextResponse.json({ error: 'Business day not found' }, { status: 404 })
  }
}
