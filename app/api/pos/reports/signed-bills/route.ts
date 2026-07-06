import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { getSignedBillsReport, parseFilters } from '@/lib/pos-reports'

/**
 * GET /api/pos/reports/signed-bills?outstandingOnly=&...filters
 * Signed (credit) POS orders — status/paid/balance/aging derived directly
 * from PosOrder (paymentMethod=SIGNED), not the separate cashier-side
 * SignedBill model: closing a POS order as SIGNED never creates a
 * SignedBill row today, so that model would show nothing for MyPOS orders.
 * Serves both "Signed Bills" and "Outstanding Signed Bills" (outstandingOnly=true).
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outstandingOnly = req.nextUrl.searchParams.get('outstandingOnly') === 'true'
  const rows = await getSignedBillsReport(parseFilters(req.nextUrl.searchParams), outstandingOnly)
  return NextResponse.json({ rows })
}
