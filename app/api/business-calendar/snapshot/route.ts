import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getBusinessCalendarSnapshot } from '@/lib/business-calendar'

/** GET — the live Business Calendar Dashboard widget for one outlet (or globally). ?outletId= */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const outletId = new URL(req.url).searchParams.get('outletId') || user.outletId || null
  const snapshot = await getBusinessCalendarSnapshot(outletId)
  return NextResponse.json(snapshot)
}
