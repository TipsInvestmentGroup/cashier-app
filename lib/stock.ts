// Counter stock management — Phase 1 slice of the broader Inventory
// blueprint. Tracking is opt-in per product-per-counter: a StockLevel row
// only exists once someone has restocked that product there at least once
// (see restockCounter). recordItemPrepared silently no-ops for anything not
// yet tracked, so untracked products never accumulate phantom negative
// stock just because sales keep happening.
import { prisma } from './prisma'
import { roundMoney } from './utils'

export interface StockActionResult {
  tracked: boolean
  quantity?: number
}

/**
 * Manager tops up a counter's stock — the stand-in for a real Store→Counter
 * transfer until Procurement/Main Store (a later phase) exists. Creates the
 * StockLevel row if this is the first time this product is tracked here.
 */
export async function restockCounter(opts: {
  productId: string
  outletId: string
  counterCode: string
  quantity: number
  note?: string
  userId: string
}): Promise<StockActionResult> {
  const product = await prisma.product.findUnique({ where: { id: opts.productId }, select: { name: true } })
  if (!product) throw new Error('Product not found')

  return prisma.$transaction(async (tx) => {
    const level = await tx.stockLevel.upsert({
      where: { productId_outletId_counterCode: { productId: opts.productId, outletId: opts.outletId, counterCode: opts.counterCode } },
      update: { quantity: { increment: opts.quantity } },
      create: { productId: opts.productId, outletId: opts.outletId, counterCode: opts.counterCode, quantity: opts.quantity },
    })
    await tx.stockLedgerEntry.create({
      data: {
        productId: opts.productId, productName: product.name, outletId: opts.outletId, counterCode: opts.counterCode,
        type: 'RESTOCK', quantity: opts.quantity, balanceAfter: level.quantity,
        note: opts.note || null, createdById: opts.userId,
      },
    })
    return { tracked: true, quantity: level.quantity }
  })
}

/**
 * Called at the exact moment an order item transitions to PREPARED (the
 * item has physically left the counter) — see app/api/pos/orders/[id]/
 * send/route.ts (DIRECT counters) and app/api/pos/counter/route.ts (PATCH,
 * PREP counters). Best-effort: a stock-tracking failure must never block
 * the actual order/counter action, same principle as lib/push.ts's
 * notification calls never blocking the order flow.
 */
export async function recordItemPrepared(opts: {
  itemId: string
  productId: string
  productName: string
  quantity: number
  outletId: string
  counterCode: string | null
  userId: string
}): Promise<StockActionResult> {
  try {
    if (!opts.counterCode) return { tracked: false }
    const existing = await prisma.stockLevel.findUnique({
      where: { productId_outletId_counterCode: { productId: opts.productId, outletId: opts.outletId, counterCode: opts.counterCode } },
    })
    if (!existing) return { tracked: false } // not opted into tracking at this counter — silent no-op

    return await prisma.$transaction(async (tx) => {
      const level = await tx.stockLevel.update({
        where: { productId_outletId_counterCode: { productId: opts.productId, outletId: opts.outletId, counterCode: opts.counterCode! } },
        data: { quantity: { decrement: opts.quantity } },
      })
      await tx.stockLedgerEntry.create({
        data: {
          productId: opts.productId, productName: opts.productName, outletId: opts.outletId, counterCode: opts.counterCode!,
          type: 'SALE', quantity: -opts.quantity, balanceAfter: roundMoney(level.quantity),
          refType: 'PosOrderItem', refId: opts.itemId, createdById: opts.userId,
        },
      })
      return { tracked: true, quantity: level.quantity }
    })
  } catch (err) {
    console.error('[stock] recordItemPrepared failed for product', opts.productId, err)
    return { tracked: false }
  }
}
