// The cash-in GL posting for one Daily Collection, extracted from the
// collections POST route so the exact same logic can BACKFILL historical
// collections that were recorded before collections posted to the GL
// (see scripts/backfill-collections-to-gl.ts). Posting:
//   Dr Cash / Bank / Mobile-Money (per channel, summed by resolved account)
//   Cr Sales Revenue                     (the ordinary revenue portion)
//   Cr Excess-Payable                    (the payable portion of an over-collection)
// The credits sum to `total` because the debits do.
import { postJournalEntry, reverseJournalEntry, isPeriodLocked, type Db } from '@/lib/ledger'
import { resolveAccountId, resolveChannelAccountId, resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { channelAmountsFor } from '@/lib/collection-channels-shared'
import { classForReason } from '@/lib/reconciliation-classification'
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
 * The collection's LIVE cash-in entry: not reversed, and not itself a
 * reversal. A reversal is a normal POSTED entry carrying the same
 * sourceType/sourceId (lib/ledger.ts reverseJournalEntry), so filtering on
 * status alone would mistake it for the live entry.
 */
export function liveCollectionEntryWhere(collectionId: string) {
  return { sourceType: 'DailyCollection', sourceId: collectionId, status: { not: 'REVERSED' }, reversalOfId: null }
}

/**
 * Post a collection's cash-in to the GL. Idempotent: no-ops if a non-reversed
 * COLLECTIONS entry already exists for this collection (so the backfill is safe
 * to re-run, and a normal create — which has no prior entry — always posts).
 */
export async function postCollectionCashIn(db: Db, input: PostCollectionCashInInput): Promise<{ posted: boolean }> {
  if (input.total <= 0) return { posted: false }

  const already = await db.journalEntry.findFirst({
    where: liveCollectionEntryWhere(input.collectionId),
    select: { id: true },
  })
  if (already) return { posted: false }

  const lines = await buildCollectionCashInLines(db, input)
  if (!lines.length) return { posted: false }

  await postJournalEntry(db, {
    companyId: input.companyId, entryDate: input.entryDate, sourceModule: 'COLLECTIONS', sourceType: 'DailyCollection', sourceId: input.collectionId,
    description: `Daily collection ${input.collectionId}`, createdById: input.createdById,
    lines,
  })
  return { posted: true }
}

type CashInLine = { accountId: string; debit?: number; credit?: number; outletId: string }

/** The balanced journal lines a collection's cash-in should carry right now
 *  (empty when there is nothing to post). */
async function buildCollectionCashInLines(db: Db, input: Omit<PostCollectionCashInInput, 'entryDate' | 'createdById' | 'collectionId'>): Promise<CashInLine[]> {
  if (input.total <= 0) return []
  // Debit each paid channel to its resolved GL account, summed per account.
  const accountTotals = new Map<string, number>()
  for (const [code, rawAmount] of Object.entries(input.amountsByCode)) {
    const channelAmount = roundMoney(Number(rawAmount) || 0)
    if (channelAmount <= 0) continue
    const accountId = await resolveChannelAccountId(db, { companyId: input.companyId, channelCode: code, outletId: input.outletId })
    accountTotals.set(accountId, roundMoney((accountTotals.get(accountId) || 0) + channelAmount))
  }
  const debitLines = [...accountTotals].map(([accountId, amount]) => ({ accountId, debit: amount, outletId: input.outletId }))
  if (!debitLines.length) return []

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

  return [...debitLines, ...creditLines]
}

/** Order-independent fingerprint of a set of journal lines. */
function linesKey(lines: { accountId: string; debit?: number | null; credit?: number | null; outletId?: string | null }[]): string {
  return lines
    .map((l) => `${l.accountId}|${l.outletId || ''}|${roundMoney(l.debit || 0)}|${roundMoney(l.credit || 0)}`)
    .sort()
    .join(';')
}

/**
 * Bring a collection's cash-in journal entry in line with its CURRENT stored
 * figures — the one GL path for create, edit, validate and (later) approved
 * amendments. Never edits a posted entry: if the figures changed, the live
 * entry is reversed and a fresh one posted. The fresh entry keeps the
 * collection's own business date while that financial period is open; once the
 * period is locked it posts in the current period instead (reversals always
 * post today — lib/ledger.ts reverseJournalEntry). No-op when nothing changed.
 */
export async function syncCollectionGl(db: Db, collectionId: string, actorId: string): Promise<{ changed: boolean }> {
  const c = await db.dailyCollection.findUnique({
    where: { id: collectionId },
    include: { outlet: { select: { companyId: true } }, channels: true, excessItems: true },
  })
  const existing = await db.journalEntry.findFirst({
    where: liveCollectionEntryWhere(collectionId),
    include: { lines: true },
  })
  if (!c) return { changed: false }
  const companyId = c.outlet?.companyId || (await resolveDefaultCompanyId(db))
  if (!companyId) return { changed: false }

  const payableExcessForGl = roundMoney(
    c.excessItems
      .filter((x) => (x.accountingClass || classForReason(x.reason, x.category)) === 'PAYABLE')
      .reduce((s, x) => s + x.amount, 0),
  )
  const desired = await buildCollectionCashInLines(db, {
    companyId, outletId: c.outletId, total: c.total, payableExcessForGl,
    amountsByCode: { CASH: c.cash || 0, ...channelAmountsFor(c) },
  })

  if (existing && linesKey(existing.lines) === linesKey(desired)) return { changed: false }
  if (!existing && !desired.length) return { changed: false }

  if (existing) {
    await reverseJournalEntry(db, { journalEntryId: existing.id, userId: actorId, reason: `Collection ${collectionId} figures changed` })
  }
  if (desired.length) {
    const entryDate = (await isPeriodLocked(db, companyId, c.date)) ? new Date() : c.date
    await postJournalEntry(db, {
      companyId, entryDate, sourceModule: 'COLLECTIONS', sourceType: 'DailyCollection', sourceId: collectionId,
      description: existing
        ? `Daily collection ${collectionId} (re-posted after change${entryDate === c.date ? '' : `; business date ${c.date.toISOString().slice(0, 10)} is in a locked period`})`
        : `Daily collection ${collectionId}`,
      createdById: actorId,
      lines: desired,
    })
  }
  return { changed: true }
}
