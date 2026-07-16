import crypto from 'crypto'
import { CATEGORY_TO_BILLTYPE } from '@/lib/categories'
import { roundMoney } from '@/lib/utils'
import { generateBillReference, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'

// Accepts a PrismaClient or an interactive-transaction client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface AllocArgs {
  payerName: string
  category?: string | null
  /** Explicit category/bill-type code to match against (preferred for custom categories). */
  categoryBillType?: string | null
  totalAmount: number
  selectedBillIds?: string[]
  paymentMethod: string
  outletId: string
  cashierId: string
  date: Date
  billRef?: string | null
  notes?: string | null
  personId?: string | null
}

/**
 * Allocate a payment across a member's outstanding signed bills of the SAME
 * category (billType). Selected bills are paid first, then any excess flows to
 * the member's other unpaid bills oldest-first (FIFO). A leftover after every
 * bill is settled is recorded as an unlinked credit so nothing goes unrecorded.
 *
 * Creates one PaidBill per bill it (partially) settles and keeps each linked
 * signed bill's status (UNPAID/PARTIAL/PAID) in sync.
 */
export async function allocatePayment(db: Db, a: AllocArgs) {
  const type = a.categoryBillType || (a.category ? CATEGORY_TO_BILLTYPE[a.category] : undefined)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { personName: a.payerName, status: { not: 'PAID' } }
  if (type) where.billType = type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bills: any[] = a.payerName ? await db.signedBill.findMany({ where, orderBy: { date: 'asc' } }) : []

  // Selected first (in the given order), then the rest oldest-first.
  const sel = a.selectedBillIds || []
  const selectedBills = sel.map((id) => bills.find((b) => b.id === id)).filter(Boolean) as typeof bills
  const rest = bills.filter((b) => !sel.includes(b.id)) // already date asc
  const ordered = [...selectedBills, ...rest]

  let leftover = roundMoney(a.totalAmount)
  const allocations: { billId: string; amount: number }[] = []

  for (const b of ordered) {
    if (leftover <= 0) break
    const agg = await db.paidBill.aggregate({ where: { signedBillId: b.id }, _sum: { amountPaid: true } })
    const remaining = roundMoney(b.amount - (agg._sum.amountPaid || 0))
    if (remaining <= 0) continue
    const pay = roundMoney(Math.min(remaining, leftover))
    const recordId = crypto.randomUUID()
    // Linked to a signed bill — its billType is the truest legacy signal for
    // which Paid Bill type (PBA/PBD/PBS/PBC/PBJ/PBT) this payment plays.
    const billTypeCode = await resolveBillTypeCodeFromLegacy(db, 'PAID_BILL', b.billType ?? null)
    const ref = await generateBillReference(db, {
      recordId, sourceModel: 'PaidBill', billTypeCode, date: a.date, personId: a.personId || null, outletId: a.outletId,
    })
    await db.paidBill.create({
      data: {
        id: recordId,
        signedBillId: b.id, personId: a.personId || null, payerCategory: a.category || null, payerName: a.payerName,
        amountPaid: pay, paymentMethod: a.paymentMethod, notes: a.notes || null, billRef: a.billRef || null,
        outletId: a.outletId, cashierId: a.cashierId, date: a.date,
        internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
      },
    })
    const tot = (agg._sum.amountPaid || 0) + pay
    await db.signedBill.update({ where: { id: b.id }, data: { status: tot >= b.amount ? 'PAID' : tot > 0 ? 'PARTIAL' : 'UNPAID' } })
    allocations.push({ billId: b.id, amount: pay })
    leftover = roundMoney(leftover - pay)
  }

  // Anything left after all bills are settled → unlinked credit
  if (leftover > 0.0001) {
    const recordId = crypto.randomUUID()
    // No linked signed bill here — fall back to the category's mapped legacy
    // code (resolveBillTypeCodeFromLegacy falls back to PBS if it can't resolve).
    const billTypeCode = await resolveBillTypeCodeFromLegacy(db, 'PAID_BILL', type ?? null)
    const ref = await generateBillReference(db, {
      recordId, sourceModel: 'PaidBill', billTypeCode, date: a.date, personId: a.personId || null, outletId: a.outletId,
    })
    await db.paidBill.create({
      data: {
        id: recordId,
        signedBillId: null, personId: a.personId || null, payerCategory: a.category || null, payerName: a.payerName,
        amountPaid: leftover, paymentMethod: a.paymentMethod,
        notes: `${a.notes ? a.notes + ' · ' : ''}Unallocated credit`, billRef: a.billRef || null,
        outletId: a.outletId, cashierId: a.cashierId, date: a.date,
        internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
      },
    })
  }

  return { allocations, leftover: leftover > 0 ? leftover : 0, billsPaid: allocations.length }
}
