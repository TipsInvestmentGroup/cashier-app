import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import type { JWTPayload } from '@/lib/auth'

// Management roles may act on any order (cross-outlet oversight). Everyone
// else (WAITER, CASHIER) is restricted to orders at their own outlet — this
// used to be unchecked entirely, letting any authenticated account pay,
// close, or edit any order regardless of outlet.
export const ORDER_MANAGEMENT_ROLES = ['MANAGER', 'ADMIN', 'DIRECTOR']

export function canActOnOrder(user: JWTPayload, order: { outletId: string | null }): boolean {
  if (ORDER_MANAGEMENT_ROLES.includes(user.role)) return true
  return !!user.outletId && user.outletId === order.outletId
}

/**
 * Close a settled POS order and feed its net total into today's
 * DailyCollection.systemSales for the outlet. Shared by the close route
 * (full payment) and the pay route (final partial payment).
 *
 * Pass `db` (a $transaction callback's `tx` client) when the caller needs
 * this to run atomically alongside its own reads/writes — e.g. the pay route
 * re-reads the order's balance and settles it inside one transaction so two
 * concurrent partial payments can't both read a stale balance and overshoot.
 * Defaults to the top-level client for callers that don't need that (close
 * route: a single full-payment action with no accumulation race).
 */
export async function settlePosOrder(opts: {
  orderId: string
  paymentMethod: string
  paidAmount: number
  userId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}, db: any = prisma) {
  const order = await db.posOrder.findUnique({ where: { id: opts.orderId } })
  if (!order || order.status === 'CLOSED') return order

  const now = new Date()
  const finalAmount = roundMoney(order.totalAmount - order.discount)

  await db.posOrder.update({
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
  const existing = await db.dailyCollection.findFirst({
    where: { outletId: order.outletId, date: { gte: todayStart } },
    orderBy: { date: 'desc' },
  })
  if (existing) {
    await db.dailyCollection.update({
      where: { id: existing.id },
      data: { systemSales: roundMoney(existing.systemSales + finalAmount) },
    })
  } else if (finalAmount > 0) {
    // No cashier has opened today's collection for this outlet yet, so there's
    // nowhere to book this sale — DailyCollection.cashierId is required and we
    // have no cashier to attribute it to. Rather than silently losing the
    // revenue with zero trace, log it so an accountant can reconcile it
    // manually. TODO: decide whether MyPos order totals should fold into a
    // later-created DailyCollection.systemSales automatically, or whether
    // that figure already includes POS sales when the cashier enters it
    // (folding both in would double-count) — flagged, not auto-resolved here.
    await db.auditLog.create({
      data: {
        userId: opts.userId, action: 'UNATTRIBUTED', entity: 'PosOrder', entityId: order.id,
        details: `Order ${order.orderNo} settled for ${finalAmount} at outlet ${order.outletId} before any DailyCollection existed for today — not counted in any systemSales figure. Needs manual reconciliation.`,
      },
    })
  }

  return order
}
