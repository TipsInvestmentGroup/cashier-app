import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { getStaffPerformance, parseFilters } from '@/lib/pos-reports'

/** GET /api/pos/reports/staff-performance?...filters — per-staff sales, bill count, avg bill, qty, signed, voided, discounts. */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await getStaffPerformance(parseFilters(req.nextUrl.searchParams))
  return NextResponse.json({ rows })
}
