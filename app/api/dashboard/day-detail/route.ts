import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
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

  const [hourly, staffTotals, totals, sourceCollections] = await Promise.all([
    getHourlyOrderBreakdown({ outletId, date: parsed }),
    getSessionsByStaff({ outletId, dateRange }),
    getSessionTotals({ outletId, dateRange }),
    // Data-integrity drill-down: the exact DailyCollection rows behind this
    // day's total, so a suspicious amount (e.g. a stray "1") can be traced
    // straight to its source record, who created/edited/deleted it, and why
    // — see components/widgets/TrendWidget.tsx's "Source Records" section.
    prisma.dailyCollection.findMany({
      where: { ...(outletId ? { outletId } : {}), date: dateRange },
      include: { cashier: { select: { name: true } }, outlet: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const topStaff = [...staffTotals].sort((a, b) => b.officialCollection - a.officialCollection).slice(0, 5)
  const paymentSplit = { cash: totals.cash, bank: totals.bank, mobileMoney: totals.mobileMoney }
  const sourceRecords = sourceCollections.map((c) => ({
    id: c.id, staffName: c.staffName, total: c.total, outletName: c.outlet.name,
    cashierName: c.cashier?.name || '—', createdAt: c.createdAt, updatedAt: c.updatedAt,
  }))

  return NextResponse.json({ hourly, topStaff, paymentSplit, sourceRecords })
}
