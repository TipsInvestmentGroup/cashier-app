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
import crypto from 'crypto'
import { prisma } from './prisma'
import type { Prisma, PrismaClient } from '@prisma/client'
import { roundMoney } from './utils'
import { generateBillReference } from './bill-reference'

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
  try {
    return await tx.stockLevel.create({
      data: { productId: key.productId, outletId: key.outletId ?? null, counterCode: key.counterCode ?? null, warehouseId: key.warehouseId ?? null, quantity: delta },
    })
  } catch (err) {
    // A concurrent call for this exact product+location's very first-ever
    // movement can race here — both see no existing row and both attempt
    // create. The @@unique constraint rejects the second create; recover by
    // falling back to the increment path instead of failing the whole call.
    if (err instanceof Error && err.message.includes('Unique')) {
      const nowExisting = await getStockLevel(tx, key)
      if (nowExisting) return tx.stockLevel.update({ where: { id: nowExisting.id }, data: { quantity: { increment: delta } } })
    }
    throw err
  }
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
 * Store Keeper posts a goods-received note — physical stock arriving at
 * Main Store, either free-form (no PO) or against a formal PurchaseOrder
 * (opts.purchaseOrderId + per-item purchaseOrderItemId set). Converts each
 * line's purchase-unit quantity (e.g. 10 Cartons) into stock units (e.g.
 * 240 pieces) via packSize, same conversion principle as
 * Product.gramsPerServing on the sell side, and bumps Main Store's
 * StockLevel + ledger in one transaction. When linked to a PO, also bumps
 * that PurchaseOrderItem's quantityReceived and re-derives the PO's overall
 * status (PARTIALLY_RECEIVED / FULLY_RECEIVED).
 */
export async function receiveGrn(opts: {
  warehouseId: string
  supplierName: string
  invoiceRef?: string
  note?: string
  purchaseOrderId?: string
  items: Array<{ productId: string; purchaseUnit: string; packSize: number; quantityOrdered: number; unitCost?: number; purchaseOrderItemId?: string }>
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
        purchaseOrderId: opts.purchaseOrderId || null,
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
          purchaseOrderItemId: item.purchaseOrderItemId || null,
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

      if (item.purchaseOrderItemId) {
        // Re-check against the PO line's own remaining quantity, not the
        // client-supplied one — a stale prefill or an overtyped value could
        // otherwise record receipt of far more than was ever ordered, with
        // nothing downstream ever catching or clamping it.
        const poItem = await tx.purchaseOrderItem.findUnique({ where: { id: item.purchaseOrderItemId } })
        if (!poItem) throw new Error('Purchase order line not found')
        const remaining = roundMoney(poItem.quantity - poItem.quantityReceived)
        if (item.quantityOrdered > remaining + 0.001) {
          throw new Error(`Cannot receive ${item.quantityOrdered} ${item.purchaseUnit} for ${productName} — only ${remaining} remaining on the purchase order`)
        }
        await tx.purchaseOrderItem.update({
          where: { id: item.purchaseOrderItemId },
          data: { quantityReceived: { increment: item.quantityOrdered } },
        })
      }
    }

    if (opts.purchaseOrderId) {
      const po = await tx.purchaseOrder.findUnique({ where: { id: opts.purchaseOrderId }, select: { status: true } })
      const poItems = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: opts.purchaseOrderId } })
      const fullyReceived = poItems.every((i) => i.quantityReceived >= i.quantity)
      const anyReceived = poItems.some((i) => i.quantityReceived > 0)
      const nextStatus = fullyReceived ? 'FULLY_RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : undefined
      // Never let a concurrent GRN against a different line of the same PO
      // regress its status backward (e.g. two GRNs racing, the slower one
      // computing PARTIALLY_RECEIVED from a stale read after the faster one
      // already reached FULLY_RECEIVED).
      const wouldRegress = po?.status === 'FULLY_RECEIVED' && nextStatus !== 'FULLY_RECEIVED'
      if (nextStatus && !wouldRegress) {
        await tx.purchaseOrder.update({ where: { id: opts.purchaseOrderId }, data: { status: nextStatus } })
      }
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

/**
 * Drafts a Purchase Order — the start of the formal Procurement flow (as
 * opposed to a no-PO GRN). Computes and persists subtotal/VAT/total rather
 * than recomputing on every read, same convention as
 * StockLedgerEntry.balanceAfter.
 */
export async function createPurchaseOrder(opts: {
  supplierId: string
  outletIds: string[]
  expectedDate?: Date
  paymentTerms?: string
  notes?: string
  items: Array<{ productId: string; purchaseUnit: string; packSize: number; quantity: number; unitPrice: number }>
  userId: string
}): Promise<{ purchaseOrderId: string; poNumber: string }> {
  if (!opts.items.length) throw new Error('At least one item is required')
  for (const item of opts.items) {
    if (!(item.quantity > 0)) throw new Error('Invalid quantity for item')
    if (!(item.packSize > 0)) throw new Error('Invalid pack size for item')
    if (!(item.unitPrice >= 0)) throw new Error('Invalid unit price for item')
  }

  const products = await prisma.product.findMany({ where: { id: { in: opts.items.map((i) => i.productId) } }, select: { id: true, name: true } })
  const productMap = new Map(products.map((p) => [p.id, p.name]))

  const VAT_RATE = 0.18
  const lineAmounts = opts.items.map((item) => roundMoney(item.quantity * item.unitPrice))
  const subtotal = roundMoney(lineAmounts.reduce((sum, a) => sum + a, 0))
  const vatAmount = roundMoney(subtotal * VAT_RATE)
  const total = roundMoney(subtotal + vatAmount)

  return prisma.$transaction(async (tx) => {
    const poNumber = await nextSequenceNumber('PO', () => tx.purchaseOrder.count())
    const po = await tx.purchaseOrder.create({
      data: {
        poNumber, supplierId: opts.supplierId, status: 'DRAFT', outletIds: JSON.stringify(opts.outletIds),
        expectedDate: opts.expectedDate || null, subtotal, vatRate: VAT_RATE, vatAmount, total,
        paymentTerms: opts.paymentTerms || null, notes: opts.notes || null, createdById: opts.userId,
      },
    })

    for (let i = 0; i < opts.items.length; i++) {
      const item = opts.items[i]
      const productName = productMap.get(item.productId)
      if (!productName) throw new Error('Product not found')
      await tx.purchaseOrderItem.create({
        data: {
          purchaseOrderId: po.id, productId: item.productId, productName,
          purchaseUnit: item.purchaseUnit, packSize: item.packSize, quantity: item.quantity,
          unitPrice: item.unitPrice, amount: lineAmounts[i],
        },
      })
    }

    return { purchaseOrderId: po.id, poNumber: po.poNumber }
  })
}

/** DRAFT -> PENDING_APPROVAL. Any management user, not just the creator, can submit. */
export async function submitForApproval(purchaseOrderId: string): Promise<{ status: string }> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId } })
  if (!po) throw new Error('Purchase order not found')
  if (po.status !== 'DRAFT') throw new Error('Only a draft purchase order can be submitted for approval')
  const updated = await prisma.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: 'PENDING_APPROVAL' } })
  return { status: updated.status }
}

/**
 * PENDING_APPROVAL -> APPROVED | REJECTED. The user who created the PO
 * cannot approve it themselves — a cheap, obvious safeguard against a
 * manager drafting and immediately rubber-stamping their own order.
 */
export async function decidePurchaseOrder(opts: {
  purchaseOrderId: string
  userId: string
  action: 'approve' | 'reject'
  reason?: string
}): Promise<{ status: string }> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: opts.purchaseOrderId } })
  if (!po) throw new Error('Purchase order not found')
  if (po.status !== 'PENDING_APPROVAL') throw new Error('Only a purchase order pending approval can be approved or rejected')
  if (opts.action === 'approve' && po.createdById === opts.userId) {
    throw new Error('You cannot approve your own purchase order')
  }

  const status = opts.action === 'approve' ? 'APPROVED' : 'REJECTED'
  const updated = await prisma.purchaseOrder.update({
    where: { id: opts.purchaseOrderId },
    data: {
      status,
      approvedById: opts.action === 'approve' ? opts.userId : null,
      approvedAt: opts.action === 'approve' ? new Date() : null,
      cancelledReason: opts.action === 'reject' ? (opts.reason || null) : null,
    },
  })
  return { status: updated.status }
}

/** Cancel a PO that hasn't been fully received yet. */
export async function cancelPurchaseOrder(opts: { purchaseOrderId: string; reason?: string }): Promise<{ status: string }> {
  const po = await prisma.purchaseOrder.findUnique({ where: { id: opts.purchaseOrderId } })
  if (!po) throw new Error('Purchase order not found')
  if (po.status === 'FULLY_RECEIVED' || po.status === 'CANCELLED') {
    throw new Error(`A ${po.status.toLowerCase().replace('_', ' ')} purchase order cannot be cancelled`)
  }
  const updated = await prisma.purchaseOrder.update({
    where: { id: opts.purchaseOrderId },
    data: { status: 'CANCELLED', cancelledReason: opts.reason || null },
  })
  return { status: updated.status }
}

/**
 * Which ledger types feed which reconciliation term, per scope. Counters
 * have a point-of-sale channel (SALE) to cross-check against; a warehouse
 * doesn't, so posSalesQty is pinned to 0 there — any shrinkage between
 * closingSystem and closingPhysical shows up directly as loss, which is
 * exactly right for a warehouse (see startStockCount/submitStockCount).
 */
const SCOPE_LEDGER_TYPES: Record<'COUNTER_DAILY' | 'STORE_MONTHLY', { receivings: string; transfersIn?: string; transfersOut?: string; posSales?: string }> = {
  COUNTER_DAILY: { receivings: 'RESTOCK', transfersIn: 'TRANSFER_IN', posSales: 'SALE' },
  STORE_MONTHLY: { receivings: 'GRN_RECEIVE', transfersOut: 'TRANSFER_OUT' },
}

/**
 * Starts (or resumes) today's physical stock count for a counter (scope
 * COUNTER_DAILY, location { outletId, counterCode }) or Main Store (scope
 * STORE_MONTHLY, location { warehouseId }). Idempotent — an already-
 * IN_PROGRESS session for this scope+location+today is returned as-is
 * rather than duplicated. Prefills one StockCountItem per currently-tracked
 * product: openingBalance carries forward from the last SUBMITTED count's
 * own closingPhysical (the last verified truth), or the location's live
 * StockLevel.quantity if this product has never been counted before
 * (nothing has moved between "now" and "now"). receivings/transfersIn/
 * transfersOut/posSalesQty sum the relevant StockLedgerEntry types in the
 * window since that last count (or are 0 for a first-ever count).
 */
export async function startStockCount(opts: {
  scope: 'COUNTER_DAILY' | 'STORE_MONTHLY'
  outletId?: string
  counterCode?: string
  warehouseId?: string
  userId: string
}): Promise<{ sessionId: string }> {
  const location: { outletId: string | null; counterCode: string | null; warehouseId: string | null } = opts.scope === 'STORE_MONTHLY'
    ? { outletId: null, counterCode: null, warehouseId: opts.warehouseId ?? null }
    : { outletId: opts.outletId ?? null, counterCode: opts.counterCode ?? null, warehouseId: null }
  const ledgerTypes = SCOPE_LEDGER_TYPES[opts.scope]

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const existing = await prisma.stockCountSession.findFirst({
    where: { scope: opts.scope, ...location, status: 'IN_PROGRESS', countDate: { gte: todayStart } },
  })
  if (existing) return { sessionId: existing.id }

  const levels = await prisma.stockLevel.findMany({
    where: location,
    include: { product: { select: { name: true, buyingPrice: true } } },
  })
  if (!levels.length) throw new Error('Hakuna bidhaa zinazofuatiliwa kwenye eneo hili')

  return prisma.$transaction(async (tx) => {
    const session = await tx.stockCountSession.create({
      data: { scope: opts.scope, outletId: location.outletId ?? null, counterCode: location.counterCode ?? null, warehouseId: location.warehouseId ?? null, conductedById: opts.userId },
    })

    for (const level of levels) {
      const lastItem = await tx.stockCountItem.findFirst({
        where: { productId: level.productId, session: { scope: opts.scope, outletId: location.outletId ?? null, counterCode: location.counterCode ?? null, warehouseId: location.warehouseId ?? null, status: 'SUBMITTED' } },
        orderBy: { session: { countDate: 'desc' } },
        include: { session: { select: { createdAt: true } } },
      })

      const openingBalance = lastItem ? lastItem.closingPhysical : level.quantity
      let receivings = 0
      let transfersIn = 0
      let transfersOut = 0
      let posSalesQty = 0

      if (lastItem) {
        const types = [ledgerTypes.receivings, ledgerTypes.transfersIn, ledgerTypes.transfersOut, ledgerTypes.posSales].filter((t): t is string => !!t)
        const movements = await tx.stockLedgerEntry.groupBy({
          by: ['type'],
          where: {
            productId: level.productId, outletId: level.outletId, counterCode: level.counterCode, warehouseId: level.warehouseId,
            createdAt: { gt: lastItem.session.createdAt }, type: { in: types },
          },
          _sum: { quantity: true },
        })
        for (const m of movements) {
          const sum = m._sum?.quantity ?? 0
          if (m.type === ledgerTypes.receivings) receivings = sum
          else if (ledgerTypes.transfersIn && m.type === ledgerTypes.transfersIn) transfersIn = sum
          else if (ledgerTypes.transfersOut && m.type === ledgerTypes.transfersOut) transfersOut = -sum // stored negative
          else if (ledgerTypes.posSales && m.type === ledgerTypes.posSales) posSalesQty = -sum // stored negative
        }
      }

      const closingSystem = roundMoney(openingBalance + receivings + transfersIn - transfersOut)

      await tx.stockCountItem.create({
        data: {
          sessionId: session.id, productId: level.productId, productName: level.product.name,
          openingBalance, receivings, transfersIn, transfersOut, closingSystem, posSalesQty, unitCost: level.product.buyingPrice,
        },
      })
    }

    return { sessionId: session.id }
  })
}

/**
 * Finalizes a stock count: computes the variance/loss per line, corrects
 * the counter's live StockLevel to match the physical count (writing an
 * ADJUSTMENT ledger entry, same type the Manual Adjustment escape hatch
 * uses — skipped when the physical count already matches, to avoid a
 * no-op audit-log entry), and rolls the loss portion up into the session's
 * totalLossValue. Single step — no separate review/approval.
 */
export async function submitStockCount(opts: {
  sessionId: string
  items: Array<{ id: string; closingPhysical: number; discountQty?: number; breakageQty?: number }>
  userId: string
}): Promise<{ status: string; totalLossValue: number }> {
  const session = await prisma.stockCountSession.findUnique({ where: { id: opts.sessionId }, include: { items: true } })
  if (!session) throw new Error('Stock count session not found')
  if (session.status !== 'IN_PROGRESS') throw new Error('Only an in-progress stock count can be submitted')

  const itemMap = new Map(session.items.map((i) => [i.id, i]))

  return prisma.$transaction(async (tx) => {
    let totalLossValue = 0

    for (const input of opts.items) {
      const item = itemMap.get(input.id)
      if (!item) continue // not part of this session — ignore
      const closingPhysical = roundMoney(Math.max(0, input.closingPhysical))
      // "Discount" (an authorised price concession to a customer) only
      // applies to a counter sale — it has no meaning for a Main Store
      // count, so it's zeroed there regardless of what was submitted.
      // Both fields are clamped non-negative: a negative value would
      // inflate rather than explain away the reported loss.
      const discountQty = session.scope === 'STORE_MONTHLY' ? 0 : Math.max(0, input.discountQty || 0)
      const breakageQty = Math.max(0, input.breakageQty || 0)

      const expectedSalesQty = roundMoney(item.closingSystem - closingPhysical)
      const varianceQty = roundMoney(item.posSalesQty - expectedSalesQty)
      const varianceValue = roundMoney((varianceQty - discountQty - breakageQty) * item.unitCost)
      totalLossValue += Math.max(0, -varianceValue)

      await tx.stockCountItem.update({
        where: { id: item.id },
        data: { closingPhysical, discountQty, breakageQty, expectedSalesQty, varianceQty, varianceValue },
      })

      const currentLevel = await getStockLevel(tx, { productId: item.productId, outletId: session.outletId, counterCode: session.counterCode, warehouseId: session.warehouseId })
      if (currentLevel && currentLevel.quantity !== closingPhysical) {
        const delta = roundMoney(closingPhysical - currentLevel.quantity)
        await tx.stockLevel.update({ where: { id: currentLevel.id }, data: { quantity: closingPhysical } })
        await tx.stockLedgerEntry.create({
          data: {
            productId: item.productId, productName: item.productName, outletId: session.outletId, counterCode: session.counterCode, warehouseId: session.warehouseId,
            type: 'ADJUSTMENT', quantity: delta, balanceAfter: closingPhysical,
            note: 'Stock count correction', refType: 'StockCountSession', refId: session.id, createdById: opts.userId,
          },
        })
      }
    }

    const updated = await tx.stockCountSession.update({
      where: { id: session.id },
      data: { status: 'SUBMITTED', totalLossValue: roundMoney(totalLossValue) },
    })
    return { status: updated.status, totalLossValue: updated.totalLossValue }
  })
}

/** Free-form accountability record — not an enforced reconciliation. */
export async function addLossAttribution(opts: {
  sessionId: string
  staffId: string
  amount: number
  note?: string
}): Promise<{ id: string }> {
  const staff = await prisma.user.findUnique({ where: { id: opts.staffId }, select: { name: true } })
  if (!staff) throw new Error('Staff member not found')

  const attribution = await prisma.stockLossAttribution.create({
    data: { sessionId: opts.sessionId, staffId: opts.staffId, staffName: staff.name, amount: opts.amount, note: opts.note || null },
  })
  return { id: attribution.id }
}

/**
 * Reports a breakage/expiry/damage — deducts stock immediately and gives
 * loss an explained reason the moment it happens, rather than waiting for
 * the next stock count to notice it. Unlike recordItemPrepared's silent
 * no-op for an untracked product (an expected case — most products aren't
 * tracked everywhere), reporting breakage on stock that was never tracked
 * at this location is a real usage error and throws.
 */
export async function reportBreakage(opts: {
  productId: string
  quantity: number
  reason: string
  outletId?: string
  counterCode?: string
  warehouseId?: string
  note?: string
  photoUrl?: string
  userId: string
}): Promise<{ breakageId: string }> {
  if (!(opts.quantity > 0)) throw new Error('Invalid quantity')

  const product = await prisma.product.findUnique({ where: { id: opts.productId }, select: { name: true, buyingPrice: true } })
  if (!product) throw new Error('Product not found')

  const location: LocationKey = { productId: opts.productId, outletId: opts.outletId, counterCode: opts.counterCode, warehouseId: opts.warehouseId }

  return prisma.$transaction(async (tx) => {
    const currentLevel = await getStockLevel(tx, location)
    if (!currentLevel) throw new Error('Bidhaa hii haifuatiliwi kwenye eneo hili')
    // Same guard issueTransfer already applies before decrementing Main
    // Store stock — reporting more breakage than is physically on the
    // shelf would otherwise push stock negative silently.
    if (currentLevel.quantity < opts.quantity) {
      throw new Error(`Insufficient stock for ${product.name} (available: ${currentLevel.quantity}, requested: ${opts.quantity})`)
    }

    const valueLost = roundMoney(opts.quantity * product.buyingPrice)

    // Bill Reference System — Breakage plays the "Loss Record" (LOS) bill type.
    const recordId = crypto.randomUUID()
    const ref = await generateBillReference(tx, {
      recordId, sourceModel: 'Breakage', billTypeCode: 'LOS', date: new Date(), outletId: opts.outletId ?? null,
    })

    const breakage = await tx.breakage.create({
      data: {
        id: recordId,
        productId: opts.productId, productName: product.name, quantity: opts.quantity, reason: opts.reason,
        outletId: opts.outletId ?? null, counterCode: opts.counterCode ?? null, warehouseId: opts.warehouseId ?? null,
        unitCost: product.buyingPrice, valueLost, photoUrl: opts.photoUrl || null, note: opts.note || null, reportedById: opts.userId,
        internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
      },
    })

    const level = await tx.stockLevel.update({ where: { id: currentLevel.id }, data: { quantity: { decrement: opts.quantity } } })
    await tx.stockLedgerEntry.create({
      data: {
        productId: opts.productId, productName: product.name, outletId: opts.outletId ?? null, counterCode: opts.counterCode ?? null, warehouseId: opts.warehouseId ?? null,
        type: 'BREAKAGE', quantity: -opts.quantity, balanceAfter: level.quantity,
        note: opts.reason, refType: 'Breakage', refId: breakage.id, createdById: opts.userId,
      },
    })

    return { breakageId: breakage.id }
  })
}
