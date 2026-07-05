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
 * Close a settled POS order (mark CLOSED, record payment method/amount).
 * Shared by the close route (full payment) and the pay route (final partial
 * payment).
 *
 * Does NOT touch DailyCollection.systemSales — a cashier's manually-entered
 * "System Sales" figure already reflects the day's full MyPos activity (it's
 * read off the same combined POS report), so auto-adding order totals on top
 * would double-count every sale a second time. An earlier version of this
 * function did increment it on every close, inherited from the original
 * close/route.ts before MyPos payments existed — confirmed with the business
 * owner and removed; DailyCollection.systemSales is the cashier's number
 * alone, in full, independent of when it was entered relative to POS orders.
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

  return order
}
