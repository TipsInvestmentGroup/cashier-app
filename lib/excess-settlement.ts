// Generic auto-settlement engine for the Excess Recon ledger. A Cash Recon
// excess line (money that just left the till for a reason, e.g. Kitchen
// Sales) is treated as a payment: instead of just piling up as its own new
// unpaid record, it is first applied against outstanding CollectionExcess
// balances of the same reason — oldest first by default — so the ledger
// reflects what actually happened (the till cash paid down the department's
// running debt) rather than requiring a manual Pay click per record.
//
// Matching key is (reason, staffId, personId): reason-only for identity-less
// reasons like KITCHEN_SALES (no staff/customer tag), but still scoped to the
// specific staff/customer for STAFF_TIP/CUSTOMER_EXCESS so one person's cash
// never silently settles another's balance. CASH_RECON-source rows are never
// a valid settlement target — D10 already treats them as fully disbursed at
// recon time (app/api/excess-recon/[id]/route.ts blocks settling them).
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'
import { postJournalEntry } from '@/lib/ledger'
import { resolveAccountId, resolveChannelAccountId, resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { classForReason } from '@/lib/reconciliation-classification'

export interface AutoSettleResult {
  allocated: number
  remainder: number
  settlements: { targetId: string; amount: number }[]
}

export async function autoSettleExcessPayment(tx: Db, opts: {
  reason: string
  amount: number
  staffId?: string | null
  personId?: string | null
  outletId?: string | null
  sourceCashReconExcessId: string
  userId: string
}): Promise<AutoSettleResult> {
  const amount = roundMoney(opts.amount)
  if (amount <= 0) return { allocated: 0, remainder: 0, settlements: [] }

  const reasonRow = await tx.excessReason.findUnique({ where: { code: opts.reason } })
  const strategy = reasonRow?.allocationStrategy === 'LIFO' ? 'LIFO' : 'FIFO'

  const candidates = await tx.collectionExcess.findMany({
    where: {
      reason: opts.reason,
      category: 'PAYABLE_EXCESS',
      staffId: opts.staffId || null,
      personId: opts.personId || null,
      // Cash paid out at one outlet shouldn't settle another outlet's debt.
      ...(opts.outletId ? { collection: { outletId: opts.outletId } } : {}),
    },
    include: { collection: { include: { outlet: true } } },
    orderBy: { createdAt: strategy === 'FIFO' ? 'asc' : 'desc' },
  })

  let remaining = amount
  const settlements: { targetId: string; amount: number }[] = []

  for (const row of candidates) {
    if (remaining <= 0) break
    const balance = roundMoney(row.amount - row.paidAmount)
    if (balance <= 0) continue
    const pay = roundMoney(Math.min(balance, remaining))
    if (pay <= 0) continue

    await tx.collectionExcess.update({ where: { id: row.id }, data: { paidAmount: roundMoney(row.paidAmount + pay), paidAt: new Date() } })

    // Same GL treatment as the manual Pay/batch-pay routes: a COLLECTION-source
    // PAYABLE over-collection accrued to Excess-Payable at collection time, so
    // relieving it now is Dr Excess-Payable / Cr Cash.
    if (classForReason(row.reason, row.category) === 'PAYABLE') {
      const rowOutletId = row.collection.outletId
      const companyId = row.collection.outlet?.companyId || (await resolveDefaultCompanyId(tx))
      if (companyId && rowOutletId) {
        const cashAccountId = await resolveChannelAccountId(tx, { companyId, channelCode: row.channelCode || 'CASH', outletId: rowOutletId })
        const excessPayableAccountId = await resolveAccountId(tx, { companyId, key: 'EXCESS_PAYABLE' })
        await postJournalEntry(tx, {
          companyId, entryDate: new Date(), sourceModule: 'COLLECTIONS', sourceType: 'ExcessAutoSettlement', sourceId: row.id,
          description: `Auto-settled excess payout — collection excess ${row.id} (funded by cash-recon payment ${opts.sourceCashReconExcessId})`,
          createdById: opts.userId,
          lines: [
            { accountId: excessPayableAccountId, debit: pay, outletId: rowOutletId },
            { accountId: cashAccountId, credit: pay, outletId: rowOutletId },
          ],
        })
      }
    }

    await tx.excessSettlement.create({
      data: {
        reason: opts.reason,
        method: strategy === 'FIFO' ? 'AUTO_FIFO' : 'AUTO_LIFO',
        sourceType: 'CASH_RECON_PAYMENT',
        sourceId: opts.sourceCashReconExcessId,
        targetType: 'COLLECTION',
        targetId: row.id,
        amount: pay,
        outletId: opts.outletId || row.collection.outletId || null,
        createdById: opts.userId,
      },
    })

    settlements.push({ targetId: row.id, amount: pay })
    remaining = roundMoney(remaining - pay)
  }

  return { allocated: roundMoney(amount - remaining), remainder: remaining, settlements }
}
