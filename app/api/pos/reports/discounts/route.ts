import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { getDiscountReport, parseFilters } from '@/lib/pos-reports'

/** GET /api/pos/reports/discounts?...filters — every discounted closed order, with amount/% and reason. */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await getDiscountReport(parseFilters(req.nextUrl.searchParams))
  return NextResponse.json({ rows })
}
