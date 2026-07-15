import { roundMoney } from './utils'

// Loose type — works with both the prisma singleton and a transaction client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

/**
 * Keep a collection's auto CollectionExcess row in sync with a recomputed
 * excess amount (e.g. after a linked cancellation is approved/rejected and
 * the underlying formula shifts). Only adjusts the `amount` of an EXISTING
 * row — creating one requires a cashier-selected reason, which this
 * unattended recompute path has no way to collect, so a brand-new excess
 * that only emerges here is left for the cashier to record via an edit.
 * paidAmount is never reduced below what was actually settled.
 */
export async function syncCollectionExcessAmount(db: DB, collectionId: string, newExcessAmount: number): Promise<void> {
  const existing = await db.collectionExcess.findUnique({ where: { collectionId } })
  if (!existing) return

  if (newExcessAmount <= 0) {
    if (existing.paidAmount > 0) {
      // Payments were already settled against this excess — keep the record
      // (capped at what was paid) so Excess Recon still shows it as Settled.
      await db.collectionExcess.update({ where: { collectionId }, data: { amount: existing.paidAmount } })
    } else {
      await db.collectionExcess.delete({ where: { collectionId } })
    }
    return
  }

  const amount = Math.max(roundMoney(newExcessAmount), existing.paidAmount)
  await db.collectionExcess.update({ where: { collectionId }, data: { amount } })
}
