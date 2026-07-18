import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getSessionsByStaff, getSessionTotals } from '@/lib/bi/business-sessions'
import { getHourlyOrderBreakdown } from '@/lib/bi/hourly-orders'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Level-3 drill-down for the main dashboard's "This Week" TrendWidget — one
 * day's hourly order pattern, top staff, and payment-method split. Split into
 * its own lazily-fetched route (same convention as /api/my-dashboard/analytics
 * being split from /api/my-dashboard) since it's only needed when a user
 * actually clicks into a specific day, not on every dashboard load.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = user.role === 'CASHIER' && user.outletId ? user.outletId : (searchParams.get('outletId') || user.outletId)
  const parsed = parse(searchParams.get('date') || '', 'yyyy-MM-dd', new Date())
  if (!isValid(parsed)) return NextResponse.json({ error: 'Invalid or missing date' }, { status: 400 })
  const dateRange = { gte: startOfDay(parsed), lte: endOfDay(parsed) }

  const [hourly, staffTotals, totals] = await Promise.all([
    getHourlyOrderBreakdown({ outletId, date: parsed }),
    getSessionsByStaff({ outletId, dateRange }),
    getSessionTotals({ outletId, dateRange }),
  ])

  const topStaff = [...staffTotals].sort((a, b) => b.officialCollection - a.officialCollection).slice(0, 5)
  const paymentSplit = { cash: totals.cash, bank: totals.bank, mobileMoney: totals.mobileMoney }

  return NextResponse.json({ hourly, topStaff, paymentSplit })
}
