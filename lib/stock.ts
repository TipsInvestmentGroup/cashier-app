// Counter & Main Store stock management. Tracking is opt-in per
// product-per-location: a StockLevel row only exists once someone has
// restocked/received/transferred that product there at least once (see
// restockCounter/receiveGrn/issueTransfer). recordItemPrepared silently
// no-ops for anything not yet tracked, so untracked products never
// accumulate phantom negative stock just because sales keep happening.
//
// A StockLevel/StockLedgerEntry row describes exactly one location: either
// a counter (outletId+counterCode, warehouseId null) or a warehouse
// (warehouseId set, outletId/counterCode null) — never both. Prisma's
// generated compound-unique key type requires non-null values for every
// field in the tuple, so it can't be used to look up rows where some of
// those fields are null by design; every lookup here goes through
// findFirst + update-by-id instead (see getStockLevel/upsertStockLevel).
import { prisma } from './prisma'
import type { Prisma, PrismaClient } from '@prisma/client'
import { roundMoney } from './utils'

type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export interface StockActionResult {
  tracked: boolean
  quantity?: number
}

interface LocationKey {
  productId: string
  outletId?: string | null
  counterCode?: string | null
  warehouseId?: string | null
}

function locationWhere(key: LocationKey): Prisma.StockLevelWhereInput {
  return {
    productId: key.productId,
    outletId: key.outletId ?? null,
    counterCode: key.counterCode ?? null,
    warehouseId: key.warehouseId ?? null,
  }
}

async function getStockLevel(tx: Tx, key: LocationKey) {
  return tx.stockLevel.findFirst({ where: locationWhere(key) })
}

/** Get-or-create-then-adjust — the shared upsert-by-location primitive. */
async function upsertStockLevel(tx: Tx, key: LocationKey, delta: number) {
  const existing = await getStockLevel(tx, key)
  if (existing) {
    return tx.stockLevel.update({ where: { id: existing.id }, data: { quantity: { increment: delta } } })
  }
  return tx.stockLevel.create({
    data: { productId: key.productId, outletId: key.outletId ?? null, counterCode: key.counterCode ?? null, warehouseId: key.warehouseId ?? null, quantity: delta },
  })
}

async function nextSequenceNumber(prefix: string, count: () => Promise<number>): Promise<string> {
  const n = (await count()) + 1
  return `${prefix}-${String(n).padStart(6, '0')}`
}

/**
 * Manual adjustment escape hatch — for stock arriving directly at a counter
 * outside the normal Main Store → Transfer flow (see issueTransfer below,
 * which is the real backing for day-to-day restocking now that Main Store
 * exists). Creates the StockLevel row if this is the first time this
 * product is tracked here.
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
    const level = await upsertStockLevel(tx, { productId: opts.productId, outletId: opts.outletId, counterCode: opts.counterCode }, opts.quantity)
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
    const existing = await getStockLevel(prisma, { productId: opts.productId, outletId: opts.outletId, counterCode: opts.counterCode })
    if (!existing) return { tracked: false } // not opted into tracking at this counter — silent no-op

    return await prisma.$transaction(async (tx) => {
      const level = await tx.stockLevel.update({
        where: { id: existing.id },
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

/**
 * Store Keeper posts a no-PO goods-received note — physical stock arriving
 * at Main Store. Converts each line's purchase-unit quantity (e.g. 10
 * Cartons) into stock units (e.g. 240 pieces) via packSize, same conversion
 * principle as Product.gramsPerServing on the sell side, and bumps Main
 * Store's StockLevel + ledger in one transaction.
 */
export async function receiveGrn(opts: {
  warehouseId: string
  supplierName: string
  invoiceRef?: string
  note?: string
  items: Array<{ productId: string; purchaseUnit: string; packSize: number; quantityOrdered: number; unitCost?: number }>
  userId: string
}): Promise<{ grnId: string; grnNumber: string }> {
  if (!opts.items.length) throw new Error('At least one item is required')
  for (const item of opts.items) {
    if (!(item.quantityOrdered > 0)) throw new Error(`Invalid quantity for item`)
    if (!(item.packSize > 0)) throw new Error(`Invalid pack size for item`)
  }

  const products = await prisma.product.findMany({ where: { id: { in: opts.items.map((i) => i.productId) } }, select: { id: true, name: true } })
  const productMap = new Map(products.map((p) => [p.id, p.name]))

  return prisma.$transaction(async (tx) => {
    const grnNumber = await nextSequenceNumber('GRN', () => tx.grn.count())
    const grn = await tx.grn.create({
      data: {
        grnNumber, warehouseId: opts.warehouseId, supplierName: opts.supplierName,
        invoiceRef: opts.invoiceRef || null, note: opts.note || null, createdById: opts.userId,
      },
    })

    for (const item of opts.items) {
      const productName = productMap.get(item.productId)
      if (!productName) throw new Error('Product not found')
      const piecesReceived = roundMoney(item.quantityOrdered * item.packSize)

      await tx.grnItem.create({
        data: {
          grnId: grn.id, productId: item.productId, productName,
          purchaseUnit: item.purchaseUnit, packSize: item.packSize,
          quantityOrdered: item.quantityOrdered, piecesReceived, unitCost: item.unitCost ?? null,
        },
      })

      const level = await upsertStockLevel(tx, { productId: item.productId, warehouseId: opts.warehouseId }, piecesReceived)
      await tx.stockLedgerEntry.create({
        data: {
          productId: item.productId, productName, warehouseId: opts.warehouseId,
          type: 'GRN_RECEIVE', quantity: piecesReceived, balanceAfter: level.quantity,
          refType: 'Grn', refId: grn.id, createdById: opts.userId,
        },
      })
    }

    return { grnId: grn.id, grnNumber: grn.grnNumber }
  })
}

/**
 * Manager issues stock from Main Store to an outlet counter — a single
 * atomic action (no separate request/approve/receive steps). This is the
 * real backing for what restockCounter used to fake: after this phase, the
 * intended flow is GRN into Main Store, then issueTransfer into counters.
 */
export async function issueTransfer(opts: {
  warehouseId: string
  outletId: string
  counterCode: string
  note?: string
  items: Array<{ productId: string; quantity: number }>
  userId: string
}): Promise<{ transferId: string; transferNumber: string }> {
  if (!opts.items.length) throw new Error('At least one item is required')
  for (const item of opts.items) {
    if (!(item.quantity > 0)) throw new Error('Invalid quantity for item')
  }

  const products = await prisma.product.findMany({ where: { id: { in: opts.items.map((i) => i.productId) } }, select: { id: true, name: true } })
  const productMap = new Map(products.map((p) => [p.id, p.name]))

  const warehouseLevels = await prisma.stockLevel.findMany({
    where: { warehouseId: opts.warehouseId, productId: { in: opts.items.map((i) => i.productId) } },
  })
  const availableMap = new Map(warehouseLevels.map((l) => [l.productId, l.quantity]))
  for (const item of opts.items) {
    const available = availableMap.get(item.productId) || 0
    if (available < item.quantity) {
      throw new Error(`Insufficient Main Store stock for ${productMap.get(item.productId) || item.productId} (available: ${available}, requested: ${item.quantity})`)
    }
  }

  return prisma.$transaction(async (tx) => {
    const transferNumber = await nextSequenceNumber('TRF', () => tx.stockTransfer.count())
    const transfer = await tx.stockTransfer.create({
      data: {
        transferNumber, warehouseId: opts.warehouseId, outletId: opts.outletId, counterCode: opts.counterCode,
        note: opts.note || null, createdById: opts.userId,
      },
    })

    for (const item of opts.items) {
      const productName = productMap.get(item.productId)
      if (!productName) throw new Error('Product not found')

      await tx.stockTransferItem.create({
        data: { transferId: transfer.id, productId: item.productId, productName, quantity: item.quantity },
      })

      // Re-verify inside the transaction — the pre-check above ran before this
      // transaction opened, so a concurrent transfer could have changed the
      // real balance in between. Never let Main Store stock go negative.
      const current = await getStockLevel(tx, { productId: item.productId, warehouseId: opts.warehouseId })
      if (!current || current.quantity < item.quantity) {
        throw new Error(`Insufficient Main Store stock for ${productName} (available: ${current?.quantity ?? 0}, requested: ${item.quantity})`)
      }

      const warehouseLevel = await tx.stockLevel.update({
        where: { id: current.id },
        data: { quantity: { decrement: item.quantity } },
      })
      await tx.stockLedgerEntry.create({
        data: {
          productId: item.productId, productName, warehouseId: opts.warehouseId,
          type: 'TRANSFER_OUT', quantity: -item.quantity, balanceAfter: roundMoney(warehouseLevel.quantity),
          refType: 'StockTransfer', refId: transfer.id, createdById: opts.userId,
        },
      })

      const counterLevel = await upsertStockLevel(tx, { productId: item.productId, outletId: opts.outletId, counterCode: opts.counterCode }, item.quantity)
      await tx.stockLedgerEntry.create({
        data: {
          productId: item.productId, productName, outletId: opts.outletId, counterCode: opts.counterCode,
          type: 'TRANSFER_IN', quantity: item.quantity, balanceAfter: counterLevel.quantity,
          refType: 'StockTransfer', refId: transfer.id, createdById: opts.userId,
        },
      })
    }

    return { transferId: transfer.id, transferNumber: transfer.transferNumber }
  })
}
