import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** Read-only "Discount" Reconciliation section (§12) — tracking only, no
 *  payment workflow. There's no dedicated Discount model in this app (see
 *  [[cashier-app-config-audit]]) — reads DailyCollection.discount/
 *  discountReason directly, one row per collection that recorded a discount. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const rows = await prisma.dailyCollection.findMany({
    where: {
      discount: { gt: 0 },
      ...(outletId ? { outletId } : {}),
      ...(startDate && endDate ? { date: { gte: new Date(startDate), lte: new Date(endDate) } } : {}),
    },
    orderBy: { date: 'desc' },
    take: 300,
  })

  return NextResponse.json(rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString(),
    discountType: r.discountReason || 'Discount',
    amount: r.discount,
    serviceStaff: r.staffName || '—',
  })))
}
