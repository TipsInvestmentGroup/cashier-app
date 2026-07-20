import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, WRITE_OFF_RESOURCES } from '@/lib/rbac'
import { approveWriteOff } from '@/lib/write-off'

/** POST — approve a write-off request (Finance Manager). Posts the accounting adjustment. Body: { comment? }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, WRITE_OFF_RESOURCES.APPROVE_WRITE_OFF))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }

  try {
    const request = await approveWriteOff(id, actor, body.comment)
    return NextResponse.json({ ok: true, request })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to approve write-off' }, { status: 400 })
  }
}
