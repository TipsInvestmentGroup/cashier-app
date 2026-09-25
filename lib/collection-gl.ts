// The cash-in GL posting for one Daily Collection, extracted from the
// collections POST route so the exact same logic can BACKFILL historical
// collections that were recorded before collections posted to the GL
// (see scripts/backfill-collections-to-gl.ts). Posting:
//   Dr Cash / Bank / Mobile-Money (per channel, summed by resolved account)
//   Cr Sales Revenue                     (the ordinary revenue portion)
//   Cr Excess-Payable                    (the payable portion of an over-collection)
// The credits sum to `total` because the debits do.
import { postJournalEntry, type Db } from '@/lib/ledger'
import { resolveAccountId, resolveChannelAccountId } from '@/lib/finance-mapping'
import { roundMoney } from '@/lib/utils'
import { resolveVatConfig, splitOutputVat } from '@/lib/vat'

export interface PostCollectionCashInInput {
  companyId: string
  collectionId: string
  outletId: string
  entryDate: Date
  createdById: string
  /** { CASH, CRDB, STANBIC, MPESA, <custom codes> } — cash included. */
  amountsByCode: Record<string, number>
  total: number
  /** Payable portion of any over-collection (accrues to Excess-Payable, not revenue). */
  payableExcessForGl: number
}

/**
 * Post a collection's cash-in to the GL. Idempotent: no-ops if a non-reversed
 * COLLECTIONS entry already exists for this collection (so the backfill is safe
 * to re-run, and a normal create — which has no prior entry — always posts).
 */
export async function postCollectionCashIn(db: Db, input: PostCollectionCashInInput): Promise<{ posted: boolean }> {
  if (input.total <= 0) return { posted: false }

  const already = await db.journalEntry.findFirst({
    where: { sourceType: 'DailyCollection', sourceId: input.collectionId, status: { not: 'REVERSED' } },
    select: { id: true },
  })
  if (already) return { posted: false }

  // Debit each paid channel to its resolved GL account, summed per account.
  const accountTotals = new Map<string, number>()
  for (const [code, rawAmount] of Object.entries(input.amountsByCode)) {
    const channelAmount = roundMoney(Number(rawAmount) || 0)
    if (channelAmount <= 0) continue
    const accountId = await resolveChannelAccountId(db, { companyId: input.companyId, channelCode: code, outletId: input.outletId })
    accountTotals.set(accountId, roundMoney((accountTotals.get(accountId) || 0) + channelAmount))
  }
  const debitLines = [...accountTotals].map(([accountId, amount]) => ({ accountId, debit: amount, outletId: input.outletId }))
  if (!debitLines.length) return { posted: false }

  // Split the credit: payable over-collection to the liability, the rest to
  // revenue — and, when VAT is enabled, peel output VAT out of that revenue
  // (the payable-excess portion is third-party money, never VATable).
  const payableGl = roundMoney(Math.min(Math.max(0, input.payableExcessForGl), input.total))
  const revenueCredit = roundMoney(input.total - payableGl)
  const { net: netRevenue, vat: outputVat } = splitOutputVat(revenueCredit, await resolveVatConfig())
  const creditLines: { accountId: string; credit: number; outletId: string }[] = []
  if (netRevenue > 0) {
    creditLines.push({ accountId: await resolveAccountId(db, { companyId: input.companyId, key: 'SALES_REVENUE' }), credit: netRevenue, outletId: input.outletId })
  }
  if (outputVat > 0) {
    creditLines.push({ accountId: await resolveAccountId(db, { companyId: input.companyId, key: 'VAT_OUTPUT' }), credit: outputVat, outletId: input.outletId })
  }
  if (payableGl > 0) {
    creditLines.push({ accountId: await resolveAccountId(db, { companyId: input.companyId, key: 'EXCESS_PAYABLE' }), credit: payableGl, outletId: input.outletId })
  }

  await postJournalEntry(db, {
    companyId: input.companyId, entryDate: input.entryDate, sourceModule: 'COLLECTIONS', sourceType: 'DailyCollection', sourceId: input.collectionId,
    description: `Daily collection ${input.collectionId}`, createdById: input.createdById,
    lines: [...debitLines, ...creditLines],
  })
  return { posted: true }
}
