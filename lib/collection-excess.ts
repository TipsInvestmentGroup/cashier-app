import crypto from 'crypto'
import { roundMoney } from './utils'
import { UNASSIGNED_EXCESS_REASON } from './excess-reasons'
import { generateBillReference } from './bill-reference'

// Loose type — works with both the prisma singleton and a transaction client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

/**
 * True up a collection's CollectionExcess rows to a freshly recomputed total
 * excess amount (e.g. after a linked cancellation is approved/rejected, or
 * after an edit, shifts the underlying formula). Never removes a row that
 * has payments recorded against it, and never silently drops excess that
 * has no row to absorb it — instead of vanishing, an unassigned reason is
 * created so it stays visible/payable in Excess Recon until an accountant
 * assigns a real reason.
 *
 * Adjusts existing rows in place where possible:
 *  - total <= 0: unpaid rows are deleted; paid rows are floored at paidAmount
 *    (stays visible/Settled in Excess Recon).
 *  - total increased and no unpaid row exists to absorb the delta: create a
 *    new row with reason UNASSIGNED for the delta.
 *  - total increased and an unpaid row exists: add the delta to the most
 *    recently created unpaid row.
 *  - total decreased: reduce amount starting from the most recently created
 *    unpaid row(s), never below each row's own paidAmount.
 */
export async function syncCollectionExcessTotal(db: DB, collectionId: string, newTotalExcessAmount: number): Promise<void> {
  const rows = await db.collectionExcess.findMany({ where: { collectionId }, orderBy: { createdAt: 'desc' } })
  const target = roundMoney(Math.max(0, newTotalExcessAmount))
  const paidSum = roundMoney(rows.reduce((s: number, r: { paidAmount: number }) => s + r.paidAmount, 0))
  const floor = Math.max(target, paidSum)
  const currentSum = roundMoney(rows.reduce((s: number, r: { amount: number }) => s + r.amount, 0))
  let delta = roundMoney(floor - currentSum)
  if (delta === 0) return

  if (delta < 0) {
    // Shrink from the most recently created unpaid rows first, down to each row's paid floor.
    for (const row of rows) {
      if (delta === 0) break
      const roomToShrink = roundMoney(row.amount - row.paidAmount)
      if (roomToShrink <= 0) continue
      const shrinkBy = Math.min(roomToShrink, -delta)
      const newAmount = roundMoney(row.amount - shrinkBy)
      if (newAmount <= 0 && row.paidAmount <= 0) {
        await db.collectionExcess.delete({ where: { id: row.id } })
      } else {
        await db.collectionExcess.update({ where: { id: row.id }, data: { amount: newAmount } })
      }
      delta = roundMoney(delta + shrinkBy)
    }
    return
  }

  // delta > 0 — grow the most recently created unpaid row, or create a flagged one.
  const unpaidRow = rows.find((r: { paidAmount: number }) => r.paidAmount <= 0)
  if (unpaidRow) {
    await db.collectionExcess.update({ where: { id: unpaidRow.id }, data: { amount: roundMoney(unpaidRow.amount + delta) } })
  } else {
    const collection = await db.dailyCollection.findUnique({ where: { id: collectionId }, select: { outletId: true } })
    const recordId = crypto.randomUUID()
    const ref = await generateBillReference(db, {
      recordId, sourceModel: 'CollectionExcess', billTypeCode: 'EXS', date: new Date(), personId: null, outletId: collection?.outletId ?? null,
    })
    await db.collectionExcess.create({
      data: {
        id: recordId, collectionId, amount: delta, reason: UNASSIGNED_EXCESS_REASON,
        internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
      },
    })
  }
}
