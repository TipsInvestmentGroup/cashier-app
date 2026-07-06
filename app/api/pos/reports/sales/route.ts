import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { aggregateSales, parseFilters, type GroupBy } from '@/lib/pos-reports'

const VALID_GROUP_BY: GroupBy[] = ['staff', 'product', 'category', 'counter', 'paymentMethod', 'hour', 'day', 'week', 'month']

/**
 * GET /api/pos/reports/sales?groupBy=staff|product|category|counter|
 * paymentMethod|hour|day|week|month&includeSigned=&...filters
 * Powers most of the MyPOS Reports tabs — Staff/Product/Category/Payment
 * Method/Counter/Hourly/Period Sales, Top-Selling & Slow-Moving Products —
 * all the same underlying aggregation with a different grouping dimension.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const groupBy = req.nextUrl.searchParams.get('groupBy') as GroupBy | null
  if (!groupBy || !VALID_GROUP_BY.includes(groupBy)) {
    return NextResponse.json({ error: `groupBy must be one of: ${VALID_GROUP_BY.join(', ')}` }, { status: 400 })
  }

  const filters = parseFilters(req.nextUrl.searchParams)
  const rows = await aggregateSales(filters, groupBy)
  return NextResponse.json({ rows })
}
