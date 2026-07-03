import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'

/**
 * Close a settled POS order and feed its net total into today's
 * DailyCollection.systemSales for the outlet. Shared by the close route
 * (full payment) and the pay route (final partial payment).
 */
export async function settlePosOrder(opts: {
  orderId: string
  paymentMethod: string
  paidAmount: number
  userId: string
}) {
  const order = await prisma.posOrder.findUnique({ where: { id: opts.orderId } })
  if (!order || order.status === 'CLOSED') return order

  const now = new Date()
  const finalAmount = roundMoney(order.totalAmount - order.discount)

  await prisma.posOrder.update({
    where: { id: opts.orderId },
    data: {
      status: 'CLOSED',
      paymentMethod: opts.paymentMethod,
      paidAmount: roundMoney(opts.paidAmount),
      closedAt: now,
      closedBy: opts.userId,
    },
  })

  const todayStart = new Date(now)
  todayStart.setHours(0, 0, 0, 0)
  const existing = await prisma.dailyCollection.findFirst({
    where: { outletId: order.outletId, date: { gte: todayStart } },
    orderBy: { date: 'desc' },
  })
  if (existing) {
    await prisma.dailyCollection.update({
      where: { id: existing.id },
      data: { systemSales: roundMoney(existing.systemSales + finalAmount) },
    })
  }

  return order
}
