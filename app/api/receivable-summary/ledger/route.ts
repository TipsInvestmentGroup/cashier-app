import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { getBusinessMonthRange } from '@/lib/business-periods'
import { buildPersonLedger } from '@/lib/receivable-ledger'

// GET /api/receivable-summary/ledger?personId=<id>|personName=<name>&date=<ISO>&outletId=<id>
//
// One person's Personal Ledger for a single business month (Spec v2 Task 2):
// opening balance (computed live = Σ CR − Σ DR before the month), the month's
// CR/DR entries with a running balance, and closing balance. `date` selects the
// business month (any day within it); omit for the current month. `hasPrior`
// tells the UI whether the opening-balance row is drillable to the prior month.
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const personId = searchParams.get('personId')
  const personName = searchParams.get('personName')
  if (!personId && !personName) {
    return NextResponse.json({ error: 'personId or personName is required' }, { status: 400 })
  }

  const outletId = readOutletScope(user, searchParams.get('outletId') || null)
  if (outletId === NO_OUTLET) {
    return NextResponse.json({ error: 'No outlet assigned to this account' }, { status: 403 })
  }
  const category = searchParams.get('category')
  const dateParam = searchParams.get('date')
  const parsed = dateParam ? new Date(dateParam) : new Date()
  const anchor = isNaN(parsed.getTime()) ? new Date() : parsed
  const range = await getBusinessMonthRange(outletId, anchor)

  const ledger = await buildPersonLedger({ personId, personName, category, outletId, start: range.start, end: range.end })

  // Anchor date for the PREVIOUS business month (drill-back): the day before start.
  const prevAnchor = new Date(range.start)
  prevAnchor.setDate(prevAnchor.getDate() - 1)

  return NextResponse.json({
    period: { key: range.key, name: range.name, rangeLabel: range.rangeLabel },
    prevMonthAnchor: prevAnchor.toISOString(),
    ledger,
  })
}
