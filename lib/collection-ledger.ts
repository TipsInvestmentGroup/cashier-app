// Transaction Ledger — the single source of truth for a collection's money.
//
// Every ledger-backed DailyCollection (ledgerBacked=true) gets its cash and
// per-channel totals ONLY from its StaffTransaction rows, via
// rebuildCollection() below. Nothing else may write those totals. Both
// Collection Modes feed the same rows — Transaction Verification links the
// staff's own declarations, the Default form writes one CHANNEL_TOTAL row per
// channel (itemised CASHIER_ENTERED rows arrive with the Phase 2 form) — so a
// collection produces identical figures whichever mode recorded it.
//
// rebuildCollection() then fans the figures out to everything that depends on
// them: staff loss / excess (lib/staff-loss.ts), the BI BusinessSession row,
// and the GL cash-in entry (lib/collection-gl.ts, reverse-and-repost).
import { roundMoney } from '@/lib/utils'
import { legacyFixedFields, syncCollectionChannels } from '@/lib/collection-channels'
import { recomputeStaffLoss } from '@/lib/staff-loss'
import { syncCollectionGl } from '@/lib/collection-gl'

// Loose type — works with both the prisma singleton and a transaction client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

/** Statuses whose rows count toward a collection's money. */
export const LIVE_STATUSES = ['DECLARED', 'APPROVED']

export const LEDGER_SOURCES = ['STAFF_DECLARED', 'CASHIER_ENTERED', 'CHANNEL_TOTAL'] as const
export type LedgerSource = (typeof LEDGER_SOURCES)[number]

export class DuplicateReferenceError extends Error {
  status = 409
  constructor(message: string) {
    super(message)
    this.name = 'DuplicateReferenceError'
  }
}

/** Upper-cased, whitespace-free form of a payment reference, for matching. */
export function normalizeReference(reference: string): string {
  return reference.trim().toUpperCase().replace(/\s+/g, '')
}

/**
 * The company-unique key for a digital payment reference, or null when the
 * row doesn't claim one (cash, no reference, not a PAYMENT).
 */
export async function referenceKeyFor(
  db: DB,
  args: { outletId: string | null; category: string; paymentMethod: string | null; reference: string | null },
): Promise<string | null> {
  if (args.category !== 'PAYMENT') return null
  const method = (args.paymentMethod || 'CASH').toUpperCase()
  if (method === 'CASH' || !args.reference) return null
  const ref = normalizeReference(args.reference)
  if (!ref) return null
  const outlet = args.outletId ? await db.outlet.findUnique({ where: { id: args.outletId }, select: { companyId: true } }) : null
  return `${outlet?.companyId || 'GLOBAL'}:${method}:${ref}`
}

/** Throws DuplicateReferenceError naming who already claimed this reference. */
export async function assertReferenceFree(db: DB, referenceKey: string | null, excludeId?: string): Promise<void> {
  if (!referenceKey) return
  const clash = await db.staffTransaction.findFirst({
    where: { referenceKey, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { staffName: true, date: true, createdAt: true, staff: { select: { name: true } } },
  })
  if (!clash) return
  const who = clash.staff?.name || clash.staffName || 'another staff member'
  const when = (clash.date || clash.createdAt).toISOString().slice(0, 10)
  const [, channel, ref] = referenceKey.split(':')
  throw new DuplicateReferenceError(`${channel} reference ${ref} was already recorded by ${who} on ${when}. A payment reference can only be used once.`)
}

function snapshotOf(row: { amount: number; paymentMethod: string | null; reference: string | null; staffName?: string | null; category: string }) {
  return JSON.stringify({ amount: row.amount, paymentMethod: row.paymentMethod, reference: row.reference, staffName: row.staffName ?? null, category: row.category })
}

/**
 * Replace a collection's un-itemised CHANNEL_TOTAL rows with one row per
 * non-zero amount (cash included). Itemised rows (STAFF_DECLARED /
 * CASHIER_ENTERED) are never touched here.
 */
export async function writeChannelTotalLines(db: DB, args: {
  collectionId: string
  outletId: string
  date: Date
  staffName: string | null
  cash: number
  channelAmounts: Record<string, number>
}): Promise<void> {
  await db.staffTransaction.deleteMany({ where: { collectionId: args.collectionId, source: 'CHANNEL_TOTAL' } })
  const staff = args.staffName ? await db.user.findFirst({ where: { name: args.staffName }, select: { id: true } }) : null
  const lockedAt = new Date()
  const entries: [string, number][] = [['CASH', Number(args.cash) || 0], ...Object.entries(args.channelAmounts).map(([k, v]) => [k, Number(v) || 0] as [string, number])]
  for (const [paymentMethod, raw] of entries) {
    const amount = roundMoney(raw)
    if (amount <= 0) continue
    const row = { category: 'PAYMENT', paymentMethod, amount, reference: null, staffName: args.staffName }
    await db.staffTransaction.create({
      data: {
        ...row,
        collectionId: args.collectionId, outletId: args.outletId, date: args.date, staffId: staff?.id ?? null,
        source: 'CHANNEL_TOTAL', status: 'APPROVED', lockedAt, originalSnapshot: snapshotOf(row),
      },
    })
  }
}

/**
 * Link a staff member's validated declarations to their new collection and
 * freeze them: lockedAt + an originalSnapshot of the money fields, so any later
 * amendment shows original vs current.
 */
export async function linkAndLockTransactions(db: DB, args: { ids: string[]; collectionId: string; outletId: string; date: Date; staffName: string }): Promise<void> {
  const lockedAt = new Date()
  const rows = await db.staffTransaction.findMany({ where: { id: { in: args.ids } } })
  for (const t of rows) {
    await db.staffTransaction.update({
      where: { id: t.id },
      data: {
        collectionId: args.collectionId, outletId: args.outletId, date: args.date, staffName: args.staffName,
        lockedAt, originalSnapshot: t.originalSnapshot || snapshotOf({ ...t, staffName: args.staffName }),
      },
    })
  }
}

/** Cash + per-channel totals summed from a collection's live PAYMENT rows. */
export async function ledgerTotals(db: DB, collectionId: string): Promise<{ cash: number; channelAmounts: Record<string, number>; total: number }> {
  const rows: { paymentMethod: string | null; amount: number }[] = await db.staffTransaction.findMany({
    where: { collectionId, category: 'PAYMENT', status: { in: LIVE_STATUSES } },
    select: { paymentMethod: true, amount: true },
  })
  let cash = 0
  const channelAmounts: Record<string, number> = {}
  for (const r of rows) {
    const method = (r.paymentMethod || 'CASH').toUpperCase()
    if (method === 'CASH') cash = roundMoney(cash + r.amount)
    else channelAmounts[method] = roundMoney((channelAmounts[method] || 0) + r.amount)
  }
  const total = roundMoney(cash + Object.values(channelAmounts).reduce((s, v) => s + v, 0))
  return { cash, channelAmounts, total }
}

/**
 * THE single writer of a collection's derived figures. For a ledger-backed
 * collection it re-derives cash/channels/total from the transaction rows; for
 * any collection it then re-syncs staff loss + excess + BusinessSession
 * (recomputeStaffLoss) and the GL cash-in entry. Idempotent — safe to call
 * after any change that could move the numbers. Run inside the same
 * transaction as that change so a failure (e.g. a locked financial period)
 * rolls the whole change back.
 */
export async function rebuildCollection(db: DB, collectionId: string, actorId: string): Promise<{ shortfall: number; glChanged: boolean }> {
  const c = await db.dailyCollection.findUnique({ where: { id: collectionId }, select: { id: true, ledgerBacked: true } })
  if (!c) return { shortfall: 0, glChanged: false }

  if (c.ledgerBacked) {
    const { cash, channelAmounts, total } = await ledgerTotals(db, collectionId)
    await db.dailyCollection.update({
      where: { id: collectionId },
      data: { cash, ...legacyFixedFields(channelAmounts), total },
    })
    await syncCollectionChannels(db, collectionId, channelAmounts)
  }

  const shortfall = await recomputeStaffLoss(db, collectionId)
  const { changed } = await syncCollectionGl(db, collectionId, actorId)
  return { shortfall, glChanged: changed }
}

/** True when the collection has itemised (non CHANNEL_TOTAL) money rows. */
export async function hasItemisedLines(db: DB, collectionId: string): Promise<boolean> {
  const n = await db.staffTransaction.count({
    where: { collectionId, category: 'PAYMENT', source: { not: 'CHANNEL_TOTAL' }, status: { in: LIVE_STATUSES } },
  })
  return n > 0
}
