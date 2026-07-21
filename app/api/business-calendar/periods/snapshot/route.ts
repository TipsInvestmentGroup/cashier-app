import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getBusinessPeriodSnapshot } from '@/lib/business-periods'

/** GET — live preview of all four period cycles (current/next windows +
 *  auto-generated upcoming business months) for one outlet or globally.
 *  ?outletId= &at=YYYY-MM-DD (optional: preview periods as of a past date). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const outletId = params.get('outletId') || user.outletId || null
  const atParam = params.get('at')
  const at = atParam ? new Date(atParam) : new Date()
  const now = Number.isNaN(at.getTime()) ? new Date() : at

  const snapshot = await getBusinessPeriodSnapshot(outletId, now)
  return NextResponse.json(snapshot)
}
