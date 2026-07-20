import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, WRITE_OFF_RESOURCES } from '@/lib/rbac'
import { cancelWriteOff } from '@/lib/write-off'

/** POST — the original requester cancels their own still-pending write-off request. Body: { reason? }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, WRITE_OFF_RESOURCES.REQUEST_WRITE_OFF))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }

  try {
    const request = await cancelWriteOff(id, actor, body.reason)
    return NextResponse.json({ ok: true, request })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to cancel write-off' }, { status: 400 })
  }
}
