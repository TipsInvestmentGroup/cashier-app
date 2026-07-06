import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { getStockLossReport, parseInventoryFilters } from '@/lib/inventory-reports'

/** GET /api/inventory/reports/loss?...filters — stock count variance + breakage, merged. */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await getStockLossReport(parseInventoryFilters(req.nextUrl.searchParams))
  return NextResponse.json({ rows })
}
