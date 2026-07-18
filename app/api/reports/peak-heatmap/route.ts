import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, MGMT_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid, differenceInCalendarDays } from 'date-fns'
import { EAT_OFFSET_MS } from '@/lib/staff-analytics'

/**
 * Peak-period heatmap: order volume and revenue bucketed by weekday (Mon–Sun)
 * and hour-of-day (00–23) in East Africa Time, from POS order timestamps.
 * Drives staffing decisions. Cashier-scoped; excludes cancelled/void orders.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MGMT_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const to = parseD(searchParams.get('to')) || new Date()
  const from = parseD(searchParams.get('from')) || to

  const orders = await prisma.posOrder.findMany({
    where: {
      createdAt: { gte: startOfDay(from), lte: endOfDay(to) },
      status: { notIn: ['CANCELLED', 'VOID'] },
      ...(outletId ? { outletId } : {}),
    },
    select: { createdAt: true, totalAmount: true },
  })

  // 7 weekdays × 24 hours. Index 0 = Monday so the grid reads Mon→Sun.
  const orderGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  const revenueGrid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))

  for (const o of orders) {
    const local = new Date(o.createdAt.getTime() + EAT_OFFSET_MS)
    const dow = (local.getUTCDay() + 6) % 7 // JS Sun=0 → Mon=0
    const hour = local.getUTCHours()
    orderGrid[dow][hour] += 1
    revenueGrid[dow][hour] += o.totalAmount || 0
  }

  // Round revenue cells; find the busiest cell by order count.
  let peak = { dow: 0, hour: 0, orders: 0, revenue: 0 }
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      revenueGrid[d][h] = roundMoney(revenueGrid[d][h])
      if (orderGrid[d][h] > peak.orders) peak = { dow: d, hour: h, orders: orderGrid[d][h], revenue: revenueGrid[d][h] }
    }
  }

  const totalOrders = orders.length
  const totalRevenue = roundMoney(orders.reduce((s, o) => s + (o.totalAmount || 0), 0))
  const days = differenceInCalendarDays(to, from) + 1

  return NextResponse.json({ orderGrid, revenueGrid, peak, totalOrders, totalRevenue, days, from, to })
}
