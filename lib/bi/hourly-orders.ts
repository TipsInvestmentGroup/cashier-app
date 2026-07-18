import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay } from 'date-fns'
import { localHour } from '@/lib/staff-analytics'

export interface HourlyOrderBucket { hour: number; label: string; orders: number; revenue: number }

/**
 * Flat 24-hour order/revenue breakdown for one calendar day, outlet-wide —
 * same PosOrder query and EAT-hour bucketing as
 * app/api/reports/peak-heatmap/route.ts, but for a single day rather than a
 * weekday×date-range grid (that route's own shape stays untouched). Always
 * returns all 24 hours (zero-filled), so a quiet day still renders a full bar row.
 */
export async function getHourlyOrderBreakdown({ outletId, date }: { outletId?: string | null; date: Date }): Promise<HourlyOrderBucket[]> {
  const orders = await prisma.posOrder.findMany({
    where: {
      createdAt: { gte: startOfDay(date), lte: endOfDay(date) },
      status: { notIn: ['CANCELLED', 'VOID'] },
      ...(outletId ? { outletId } : {}),
    },
    select: { createdAt: true, totalAmount: true },
  })

  const buckets: HourlyOrderBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour, label: `${String(hour).padStart(2, '0')}:00`, orders: 0, revenue: 0,
  }))

  for (const o of orders) {
    const hour = localHour(o.createdAt)
    buckets[hour].orders += 1
    buckets[hour].revenue += o.totalAmount || 0
  }
  for (const b of buckets) b.revenue = roundMoney(b.revenue)

  return buckets
}
