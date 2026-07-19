import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, format } from 'date-fns'

/** Dashboard §15 — Collection Difference cards. Each entry carries enough of
 *  a date range + reason/status to deep-link into the existing Excess Recon
 *  / Signed Bills / Cancellations pages instead of building new drill-down
 *  screens (they already support outlet/date/status filters). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = user.role === 'CASHIER' && user.outletId ? user.outletId : (searchParams.get('outletId') || undefined)
  const period = searchParams.get('period') || 'today'
  const now = new Date()
  const { start, end } = period === 'week' ? { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
    : period === 'month' ? { start: startOfMonth(now), end: endOfMonth(now) }
    : { start: startOfDay(now), end: endOfDay(now) }
  const dateFilter = { gte: start, lte: end }
  const outletFilter = outletId ? { outletId } : {}
  const qs = new URLSearchParams({ startDate: format(start, 'yyyy-MM-dd'), endDate: format(end, 'yyyy-MM-dd'), ...(outletId ? { outletId } : {}) }).toString()

  const [
    salesAgg,
    pendingExplanations,
    kitchenBalance,
    customerExcessBalance,
    staffTipBalance,
    outstandingBills,
    cancellations,
    discountAgg,
  ] = await Promise.all([
    prisma.dailyCollection.aggregate({ where: { ...outletFilter, date: dateFilter }, _sum: { systemSales: true, total: true } }),
    prisma.collectionExcess.count({ where: { reason: 'UNASSIGNED', collection: { ...outletFilter, date: dateFilter } } }),
    balanceFor('KITCHEN_SALES', outletFilter, dateFilter),
    balanceFor('CUSTOMER_EXCESS', outletFilter, dateFilter),
    balanceFor('STAFF_TIP', outletFilter, dateFilter),
    prisma.signedBill.aggregate({ where: { ...outletFilter, status: { not: 'PAID' }, billType: { not: 'STAFF_LOSS' }, date: dateFilter }, _sum: { amount: true }, _count: true }),
    prisma.cancellation.aggregate({ where: { ...outletFilter, date: dateFilter }, _sum: { amount: true }, _count: true }),
    prisma.dailyCollection.aggregate({ where: { ...outletFilter, date: dateFilter, discount: { gt: 0 } }, _sum: { discount: true }, _count: true }),
  ])

  const systemSales = salesAgg._sum.systemSales || 0
  const totalCollections = salesAgg._sum.total || 0

  return NextResponse.json({
    period, cards: [
      { key: 'systemSales', label: 'System Sales', amount: systemSales, href: `/collections?${qs}` },
      { key: 'totalCollections', label: 'Total Collections', amount: totalCollections, href: `/collections?${qs}` },
      { key: 'collectionDifference', label: 'Collection Difference', amount: systemSales - totalCollections, href: `/collections?${qs}` },
      { key: 'pendingExplanations', label: 'Pending Difference Explanations', count: pendingExplanations, href: `/excess-recon?status=PENDING&${qs}` },
      { key: 'kitchenSalesPending', label: 'Kitchen Sales Pending Payment', amount: kitchenBalance, href: `/excess-recon?status=PENDING&${qs}` },
      { key: 'customerExcessPending', label: 'Customer Excess Pending Refund', amount: customerExcessBalance, href: `/excess-recon?status=PENDING&${qs}` },
      { key: 'staffTipsPending', label: 'Staff Tips Pending Payment', amount: staffTipBalance, href: `/excess-recon?status=PENDING&${qs}` },
      { key: 'outstandingSignedBills', label: 'Outstanding Signed Bills', amount: outstandingBills._sum.amount || 0, count: outstandingBills._count, href: `/signed-bills?${qs}` },
      { key: 'cancelledSales', label: 'Cancelled Sales', amount: cancellations._sum.amount || 0, count: cancellations._count, href: `/cancellations?${qs}` },
      { key: 'discountsGiven', label: 'Discounts Given', amount: discountAgg._sum.discount || 0, count: discountAgg._count, href: `/excess-recon?${qs}` },
    ],
  })
}

async function balanceFor(reason: string, outletFilter: Record<string, unknown>, dateFilter: { gte: Date; lte: Date }) {
  const [collectionRows, cashReconRows] = await Promise.all([
    prisma.collectionExcess.findMany({ where: { reason, category: 'PAYABLE_EXCESS', collection: { ...outletFilter, date: dateFilter } }, select: { amount: true, paidAmount: true } }),
    prisma.cashReconExcess.findMany({ where: { reason, category: 'PAYABLE_EXCESS', cashRecon: { ...outletFilter, date: dateFilter } }, select: { amount: true, paidAmount: true } }),
  ])
  const rows = [...collectionRows, ...cashReconRows]
  return rows.reduce((s, r) => s + Math.max(0, r.amount - r.paidAmount), 0)
}
