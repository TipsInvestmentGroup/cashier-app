import crypto from 'crypto'
import { roundMoney } from './utils'
import { syncCollectionExcessTotal } from './collection-excess'
import { generateBillReference, resolveBillTypeCodeFromLegacy } from './bill-reference'

// Loose type — works with both the prisma singleton and a transaction client,
// and avoids depending on generated Prisma types (regenerated on deploy).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

/**
 * Recompute and sync a collection's auto staff-loss (voucher SL-<collectionId>).
 *
 *   Staff Loss = System Sales − Collection − Signed Bills − Paid (Staff Loss)
 *                − Discount − Approved cancellations (by that staff)
 *
 * Creates / updates / deletes the STAFF_LOSS signed bill so it always reflects
 * the current figures. Call after editing a collection or after a linked
 * cancellation is approved/rejected. Returns the shortfall (0 if none).
 */
export async function recomputeStaffLoss(db: DB, collectionId: string): Promise<number> {
  const c = await db.dailyCollection.findUnique({ where: { id: collectionId }, include: { cancellations: true } })
  if (!c) return 0

  const approvedCancel = roundMoney(
    (c.cancellations || [])
      .filter((x: { status: string; amount: number }) => x.status === 'APPROVED')
      .reduce((s: number, x: { amount: number }) => s + (x.amount || 0), 0)
  )
  const shortfall = roundMoney(
    (c.systemSales || 0) - c.total - (c.creditSales || 0) - (c.paymentsReceived || 0) - (c.discount || 0) - approvedCancel
  )

  const voucher = `SL-${collectionId}`
  const sl = await db.signedBill.findUnique({ where: { autoKey: voucher } })

  // Keep the collection's excess line items in sync with the recomputed total —
  // never silently drops a newly-emerged excess. See lib/collection-excess.ts.
  await syncCollectionExcessTotal(db, collectionId, shortfall < 0 ? Math.abs(shortfall) : 0)

  if (c.staffName && shortfall > 0) {
    const person = await db.person.findFirst({ where: { name: c.staffName, type: 'STAFF_LOSS' } })
    if (sl) {
      const agg = await db.paidBill.aggregate({ where: { signedBillId: sl.id }, _sum: { amountPaid: true } })
      const paid = agg._sum.amountPaid || 0
      const status = paid >= shortfall ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID'
      await db.signedBill.update({
        where: { id: sl.id },
        data: { amount: shortfall, personName: c.staffName, personId: person?.id ?? null, serviceStaff: c.staffName, outletId: c.outletId, date: c.date, status },
      })
    } else {
      const recordId = crypto.randomUUID()
      const billTypeCode = await resolveBillTypeCodeFromLegacy(db, 'SIGNED_BILL', 'STAFF_LOSS')
      const ref = await generateBillReference(db, {
        recordId, sourceModel: 'SignedBill', billTypeCode, date: c.date, personId: person?.id ?? null, outletId: c.outletId,
      })
      await db.signedBill.create({
        data: {
          id: recordId,
          autoKey: voucher, voucherNumber: ref.displayReference, billType: 'STAFF_LOSS', personId: person?.id ?? null, personName: c.staffName,
          amount: shortfall, serviceStaff: c.staffName,
          description: `Auto staff loss (recomputed): collection ${collectionId}`,
          status: 'UNPAID', date: c.date, outletId: c.outletId, cashierId: c.cashierId,
          internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
          autoSourceCollectionId: collectionId,
        },
      })
    }
    return shortfall
  }

  // No shortfall → remove the auto loss (and any payments against it)
  if (sl) {
    await db.paidBill.deleteMany({ where: { signedBillId: sl.id } })
    await db.signedBill.delete({ where: { id: sl.id } })
  }
  return 0
}
