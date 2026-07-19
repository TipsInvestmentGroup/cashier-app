import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getBusinessCalendarAuditLog } from '@/lib/business-calendar'
import type { CalendarScope } from '@/lib/business-calendar-shared'

/** GET — recent Business Calendar audit trail (ADMIN-only). ?scope=&scopeId= */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const scope = searchParams.get('scope') as CalendarScope | null
  const scopeId = searchParams.get('scopeId')
  const rows = await getBusinessCalendarAuditLog(scope || undefined, scopeId, 100)
  return NextResponse.json(rows)
}
