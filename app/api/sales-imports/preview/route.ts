import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole, CASHIER_ROLES } from '@/lib/auth'
import { loadMasterData, resolveLines, type RawLine, type ResolvedLine } from '@/lib/sales-import'

/**
 * POST — the Clean + Validate + Map stages. Takes raw parsed rows and returns
 * them reconciled against master data (staff, products, prices, remembered
 * aliases) with data-quality flags and a summary. No DB write — pure preview.
 * Body: { outletId?, defaultDate: 'yyyy-MM-dd', rows: RawLine[] }
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const defaultDate = String(body.defaultDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(defaultDate)) return NextResponse.json({ error: 'A valid default date (yyyy-MM-dd) is required.' }, { status: 400 })
  const rows: RawLine[] = Array.isArray(body.rows) ? body.rows : []
  if (!rows.length) return NextResponse.json({ error: 'No rows to preview.' }, { status: 400 })
  if (rows.length > 20000) return NextResponse.json({ error: 'Too many rows in one file (max 20,000). Split the export.' }, { status: 400 })

  const master = await loadMasterData('')
  const lines = resolveLines(rows, master, defaultDate)

  return NextResponse.json({ lines, summary: summarize(lines) })
}

export function summarize(lines: ResolvedLine[]) {
  const s = {
    rowCount: lines.length,
    totalQty: 0,
    totalAmount: 0,
    unmatchedStaff: 0,
    unmatchedProducts: 0,
    lowConfidence: 0,
    priceMismatches: 0,
    missingValues: 0,
    duplicates: 0,
    staffCount: 0,
    productCount: 0,
  }
  const staff = new Set<string>()
  const products = new Set<string>()
  for (const l of lines) {
    s.totalQty += l.qty || 0
    s.totalAmount += l.amount || 0
    if (l.staffName) staff.add(l.staffName.toLowerCase())
    if (l.productName) products.add(l.productName.toLowerCase())
    if (l.issues.includes('UNKNOWN_STAFF') || l.issues.includes('MISSING_STAFF')) s.unmatchedStaff++
    if (l.issues.includes('UNKNOWN_PRODUCT')) s.unmatchedProducts++
    if (l.issues.includes('LOW_CONFIDENCE_STAFF') || l.issues.includes('LOW_CONFIDENCE_PRODUCT')) s.lowConfidence++
    if (l.issues.includes('PRICE_MISMATCH')) s.priceMismatches++
    if (l.issues.includes('MISSING_VALUE')) s.missingValues++
    if (l.issues.includes('DUPLICATE')) s.duplicates++
  }
  s.staffCount = staff.size
  s.productCount = products.size
  return s
}
