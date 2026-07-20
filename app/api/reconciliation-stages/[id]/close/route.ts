import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission } from '@/lib/rbac'
import { closeStage, getStageStageKey, resourceForStage } from '@/lib/reconciliation-stage'

/** POST — close a reconciliation stage by id. Body: { allowIncomplete? }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const stageKey = await getStageStageKey(id)
  if (!stageKey) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })
  if (!(await resolveResourcePermission(user, resourceForStage(stageKey)))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }

  try {
    const result = await closeStage({ stageId: id, actor, allowIncomplete: !!body.allowIncomplete })
    if (result.blocked) {
      return NextResponse.json({ error: 'Stage cannot be closed — required checks are incomplete', failing: result.failing }, { status: 400 })
    }
    return NextResponse.json({ ok: true, stage: result.stage })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to close stage' }, { status: 400 })
  }
}
