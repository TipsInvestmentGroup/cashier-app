import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from 'date-fns'

/**
 * Growth analytics for the dashboard: collections totals for this vs last week
 * (WoW) and this vs last month (MoM), each with a sparkline of recent periods.
 * Cashier-scoped to their own outlet.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const outletId = readOutletScope(user, new URL(req.url).searchParams.get('outletId'))
  const now = new Date()
  const where: Record<string, unknown> = { date: { gte: subMonths(now, 6) } }
  if (outletId) where.outletId = outletId

  const cols = await prisma.dailyCollection.findMany({ where, select: { date: true, total: true } })
  const sumIn = (from: Date, to: Date) => roundMoney(cols.filter((c) => c.date >= from && c.date <= to).reduce((s, c) => s + (c.total || 0), 0))

  // Weekly sparkline — last 8 weeks (oldest → newest)
  const weeklySpark: number[] = []
  for (let i = 7; i >= 0; i--) {
    const ref = subWeeks(now, i)
    weeklySpark.push(sumIn(startOfWeek(ref, { weekStartsOn: 1 }), endOfWeek(ref, { weekStartsOn: 1 })))
  }
  // Monthly sparkline — last 6 months
  const monthlySpark: number[] = []
  for (let i = 5; i >= 0; i--) {
    const ref = subMonths(now, i)
    monthlySpark.push(sumIn(startOfMonth(ref), endOfMonth(ref)))
  }

  const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : cur > 0 ? 100 : 0)
  const wCur = weeklySpark[7], wPrev = weeklySpark[6]
  const mCur = monthlySpark[5], mPrev = monthlySpark[4]

  return NextResponse.json({
    weekly: { current: wCur, previous: wPrev, deltaPct: pct(wCur, wPrev), spark: weeklySpark },
    monthly: { current: mCur, previous: mPrev, deltaPct: pct(mCur, mPrev), spark: monthlySpark },
  })
}
