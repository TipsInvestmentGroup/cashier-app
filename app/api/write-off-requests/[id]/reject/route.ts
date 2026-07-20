import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, WRITE_OFF_RESOURCES } from '@/lib/rbac'
import { rejectWriteOff } from '@/lib/write-off'

/** POST — reject a write-off request. Body: { comment }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, WRITE_OFF_RESOURCES.APPROVE_WRITE_OFF))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!body.comment) return NextResponse.json({ error: 'A comment is required to reject a write-off request' }, { status: 400 })

  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }
  try {
    const request = await rejectWriteOff(id, actor, body.comment)
    return NextResponse.json({ ok: true, request })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to reject write-off' }, { status: 400 })
  }
}
