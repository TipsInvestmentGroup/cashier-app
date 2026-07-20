import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { requestUnlock } from '@/lib/reconciliation-stage'

/** POST — request an unlock for a closed stage (non-management roles). Body: { reason, requestedDuration?, requestedMinutes? }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!body.reason) return NextResponse.json({ error: 'A reason is required' }, { status: 400 })

  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }
  const request = await requestUnlock({
    stageId: id,
    actor,
    reason: body.reason,
    requestedDuration: body.requestedDuration ?? null,
    requestedMinutes: body.requestedMinutes ?? null,
  })
  return NextResponse.json({ ok: true, request })
}
