import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { getBusinessMonthRange, resolveEffectivePeriodFields } from '@/lib/business-periods'
import { monthlyPeriodForDate } from '@/lib/business-periods-shared'
import { buildReceivableSummary } from '@/lib/receivable-ledger'

// GET /api/receivable-summary?date=<ISO within target business month>&outletId=<id>&full=1
//
// Returns the Daily Receivable Summary (Spec v2 §B) for one business month —
// per-person aggregates grouped into the six category sections, with subtotals
// and a grand total. `full=1` ignores the month window and reports all-time
// (the explicit "Full History" export, §D). CASHIERs are locked to their outlet.
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId') || null)
  if (outletId === NO_OUTLET) {
    return NextResponse.json({ error: 'No outlet assigned to this account' }, { status: 403 })
  }
  const full = searchParams.get('full') === '1'
  const dateParam = searchParams.get('date')
  const parsed = dateParam ? new Date(dateParam) : new Date()
  const anchor = isNaN(parsed.getTime()) ? new Date() : parsed

  // Business-month window (or all-time for a Full History export).
  const range = full
    ? { start: new Date(0), end: new Date(8640000000000000), name: 'All time', rangeLabel: 'Full history', key: 'ALL' }
    : await getBusinessMonthRange(outletId, anchor)

  const summary = await buildReceivableSummary({ outletId, start: range.start, end: range.end })

  // Selectable months for the picker: the target month + the 11 before it.
  const fields = await resolveEffectivePeriodFields({ outletId, date: anchor })
  const months: { key: string; name: string; rangeLabel: string; anchor: string }[] = []
  let cursor = full ? new Date() : new Date(range.start)
  for (let i = 0; i < 12; i++) {
    const p = monthlyPeriodForDate(cursor, fields.businessMonthStartDay)
    months.push({ key: p.key, name: p.name, rangeLabel: p.rangeLabel, anchor: p.start.toISOString() })
    cursor = new Date(p.start)
    cursor.setDate(cursor.getDate() - 1)
  }

  return NextResponse.json({
    period: { key: range.key, name: range.name, rangeLabel: range.rangeLabel, full },
    months,
    outletId,
    summary,
  })
}
