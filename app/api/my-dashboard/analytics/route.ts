import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getHourlyBreakdown, getDayOverDay, getPerformanceTrends } from '@/lib/staff-analytics'
import { startOfDay, parse, isValid } from 'date-fns'

/**
 * GET — Staff Data Insights & Analytics (Time-vs-Time, Day-over-Day,
 * Performance Trends) for the caller's own outlet/day. Split out from
 * /api/my-dashboard so the main dashboard's first paint isn't held up by the
 * heavier historical queries this needs (30-day window, yesterday lookup).
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!user.outletId) return NextResponse.json({ error: 'No outlet assigned' }, { status: 400 })

  const dateParam = new URL(req.url).searchParams.get('date')
  const parsed = dateParam ? parse(dateParam, 'yyyy-MM-dd', new Date()) : new Date()
  const date = startOfDay(isValid(parsed) ? parsed : new Date())
  const outletId = user.outletId

  const session = await prisma.transactionSession.findUnique({ where: { outletId_date: { outletId, date } } })

  const [hourly, dayOverDay, trends] = await Promise.all([
    session ? getHourlyBreakdown(session.id, user.userId) : Promise.resolve({ buckets: [], peakHour: null, slowHour: null }),
    getDayOverDay(outletId, user.name, user.userId, date),
    getPerformanceTrends(outletId, user.name, date),
  ])

  return NextResponse.json({ hourly, dayOverDay, trends })
}
