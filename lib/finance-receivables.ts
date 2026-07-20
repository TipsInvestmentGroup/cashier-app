// Shared "what counts as outstanding" logic for Accounts Receivable — used
// by both app/api/receivables/route.ts (the full per-bill aging report)
// and lib/finance-dashboard.ts (just the total). Previously each computed
// this independently and had silently drifted: the dashboard excluded
// WRITTEN_OFF bills and subtracted write-off amounts; the receivables route
// did neither (a pre-existing gap from before Stage 2 added SignedBillWriteOff).
// One shared definition means they can never disagree again.
import { approvalGate } from './bill-types'
import type { Prisma } from '@prisma/client'

export function outstandingReceivablesWhere(opts: { billType?: string | null; outletId?: string | null; companyId?: string | null } = {}): Prisma.SignedBillWhereInput {
  const where: Prisma.SignedBillWhereInput = {
    status: { notIn: ['PAID', 'WRITTEN_OFF'] },
    ...approvalGate(),
  }
  if (opts.billType) where.billType = opts.billType
  if (opts.outletId) where.outletId = opts.outletId
  else if (opts.companyId) where.outlet = { companyId: opts.companyId }
  return where
}

/** A bill's outstanding balance: original amount minus everything paid AND
 *  everything written off. Never negative (a bill can't owe less than 0). */
export function outstandingBalance(bill: { amount: number; payments: { amountPaid: number }[]; writeOffs?: { amount: number }[] }): number {
  const totalPaid = bill.payments.reduce((s, p) => s + p.amountPaid, 0)
  const totalWrittenOff = (bill.writeOffs || []).reduce((s, w) => s + w.amount, 0)
  return Math.max(0, bill.amount - totalPaid - totalWrittenOff)
}
