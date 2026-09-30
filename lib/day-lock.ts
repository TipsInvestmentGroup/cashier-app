// Transaction Ledger — Phase 0 guardrail: one answer to "may this outlet's
// business day still be changed?", applied to EVERY role. Before this, only
// the CASHIER role was stopped from editing a closed day; managers/admins
// could silently rewrite closed-day collections. Now a closed day changes only
// after a formal, audited reopen (lib/business-day.ts reopenBusinessDay), and
// itemised transactions stay immutable even then (lib/collection-ledger.ts).
import { startOfDay } from 'date-fns'
import { resolveCollectionMode, type CollectionMode } from '@/lib/collection-mode'

// Loose type — works with both the prisma singleton and a transaction client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

export class DayLockedError extends Error {
  status = 423
  constructor(message = 'This business day is closed. It must be formally reopened (Unlock Requests) before anything on it can change.') {
    super(message)
    this.name = 'DayLockedError'
  }
}

/**
 * True when the outlet's business day is closed. BusinessDay is authoritative
 * (CLOSED/ARCHIVED, or REOPENED whose unlock window has already expired — the
 * lazy auto-lock may not have run yet); DayClosure is the legacy fallback for
 * days closed before BusinessDay existed.
 */
export async function isDayLocked(db: DB, outletId: string, date: Date): Promise<boolean> {
  const day = startOfDay(date)
  const bd = await db.businessDay.findUnique({
    where: { outletId_date: { outletId, date: day } },
    select: { status: true, lockExpiresAt: true },
  })
  if (bd) {
    if (bd.status === 'CLOSED' || bd.status === 'ARCHIVED') return true
    if (bd.status === 'REOPENED') return !!bd.lockExpiresAt && bd.lockExpiresAt < new Date()
    return false
  }
  const closure = await db.dayClosure.findUnique({ where: { outletId_date: { outletId, date: day } }, select: { id: true } })
  return !!closure
}

export async function assertDayUnlocked(db: DB, outletId: string, date: Date, message?: string): Promise<void> {
  if (await isDayLocked(db, outletId, date)) throw new DayLockedError(message)
}

/**
 * The Collection Mode this business day runs under. Resolved from Setup →
 * Collection Mode on the day's first collection activity and then frozen on
 * the BusinessDay row, so changing an outlet's mode applies from the next
 * business day and one day is never split between two modes.
 */
export async function dayCollectionMode(db: DB, outletId: string, date: Date): Promise<CollectionMode> {
  const day = startOfDay(date)
  const bd = await db.businessDay.findUnique({ where: { outletId_date: { outletId, date: day } }, select: { id: true, collectionMode: true } })
  if (bd?.collectionMode) return bd.collectionMode as CollectionMode
  const mode = await resolveCollectionMode({ outletId })
  // upsert, not create: two cashiers' first saves of the day can race.
  const row = await db.businessDay.upsert({
    where: { outletId_date: { outletId, date: day } },
    update: {},
    create: { outletId, date: day, status: 'OPEN', collectionMode: mode },
  })
  if (row.collectionMode) return row.collectionMode as CollectionMode
  await db.businessDay.update({ where: { id: row.id }, data: { collectionMode: mode } })
  return mode
}
