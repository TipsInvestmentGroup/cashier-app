import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getEventConfig, setEventConfig } from '@/lib/event-config-db'
import { SCHEDULE_MANAGE_ROLES } from '@/lib/scheduling'

/** Event type / expense category picker options. Any authed user may read. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getEventConfig())
}

/** Update — same roles that can manage events (Manager/Director/Admin). */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!SCHEDULE_MANAGE_ROLES.includes(user.role)) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const next = await setEventConfig(body || {})
  return NextResponse.json(next)
}
