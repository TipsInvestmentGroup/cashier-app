import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { addLossAttribution } from '@/lib/stock'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/inventory/stock-counts/[id]/attributions
 * body: { staffId, amount, note? }
 * Free-form loss accountability — see lib/stock.ts's addLossAttribution.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { staffId, amount, note } = await req.json().catch(() => ({}))
  const parsedAmount = Number(amount)
  if (!staffId || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return NextResponse.json({ error: 'staffId and a positive amount are required' }, { status: 400 })
  }

  try {
    const result = await addLossAttribution({
      sessionId: id, staffId, amount: parsedAmount,
      note: typeof note === 'string' ? note.trim().slice(0, 300) || undefined : undefined,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to add attribution' }, { status: 400 })
  }
}
