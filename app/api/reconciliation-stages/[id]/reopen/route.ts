import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { reopenStage } from '@/lib/reconciliation-stage'

/** POST — direct reopen (management only, no unlock-request needed). Body: { reason }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.UNLOCK_RECONCILIATION_STAGE))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!body.reason) return NextResponse.json({ error: 'A reason is required to reopen a closed stage' }, { status: 400 })

  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }
  try {
    const stage = await reopenStage({ stageId: id, actor, reason: body.reason })
    return NextResponse.json({ ok: true, stage })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to reopen stage' }, { status: 400 })
  }
}
