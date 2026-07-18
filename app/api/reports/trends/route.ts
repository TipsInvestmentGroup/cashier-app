import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, readOutletScope, MGMT_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { resolvePeriod, pctChange, type Grain, type CompareMode } from '@/lib/periods'
import { getSessionsForRange } from '@/lib/bi/business-sessions'
import { trendLabel } from '@/lib/bi/insights'

/**
 * Period-over-period trends (MoM / QoQ / YoY) for collections and system sales.
 * Uses the shared period engine: current vs comparison window plus a trailing
 * series for charting. Cashier-scoped to their own outlet.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MGMT_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const grain = (['month', 'quarter', 'year'].includes(searchParams.get('grain') || '') ? searchParams.get('grain') : 'quarter') as Grain
  const compareMode = (searchParams.get('compare') === 'yoy' ? 'yoy' : 'sequential') as CompareMode

  const p = resolvePeriod(grain, compareMode)
  // Single fetch spanning the earliest needed window through the current end.
  const minStart = [p.series[0].start, p.compare.start].reduce((a, b) => (a < b ? a : b))
  const maxEnd = [p.current.end, p.compare.end].reduce((a, b) => (a > b ? a : b))

  const sessions = (await getSessionsForRange({ outletId, dateRange: { gte: minStart, lte: maxEnd } })) as
    Array<{ date: Date; officialCollection: number; systemSales: number }>

  const sumWindow = (start: Date, end: Date) => {
    let collected = 0, systemSales = 0
    for (const s of sessions) {
      if (s.date >= start && s.date <= end) { collected += s.officialCollection || 0; systemSales += s.systemSales || 0 }
    }
    return { collected: roundMoney(collected), systemSales: roundMoney(systemSales) }
  }

  const current = { ...p.current, ...sumWindow(p.current.start, p.current.end) }
  const compare = { ...p.compare, ...sumWindow(p.compare.start, p.compare.end) }
  const series = p.series.map((w) => ({ label: w.label, ...sumWindow(w.start, w.end) }))

  return NextResponse.json({
    grain, compareMode,
    current: { label: current.label, collected: current.collected, systemSales: current.systemSales },
    compare: { label: compare.label, collected: compare.collected, systemSales: compare.systemSales },
    delta: {
      collectedPct: pctChange(current.collected, compare.collected),
      systemSalesPct: pctChange(current.systemSales, compare.systemSales),
      collectedAbs: roundMoney(current.collected - compare.collected),
    },
    series,
    trend: trendLabel(series.map((w) => w.collected)),
  })
}
