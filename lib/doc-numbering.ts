/**
 * Per-company document numbering (multi-company Phase 3 step 3f).
 *
 * Every human-readable document number (JE-000001, PO-/GRN-/TRF-, INV-/PAY-, ORD-YYYYMMDD-NNN, EXP-…, bill references,
 * person codes) is drawn from an atomic counter row keyed by (companyId, scopeKey) in one of two counter tables:
 * `BillSequenceCounter` (lastValue) or `ExpenseRequestSequence` (lastNumber). Each company therefore has its own
 * independent sequences; the original company keeps the counter rows it has always used, so its numbering continues
 * exactly where it was (same formats, no reset, no gap).
 *
 * Race-safety: the increment is a single `UPDATE … SET n = n + 1 … RETURNING`, which row-locks the counter until the
 * caller's transaction ends, so two concurrent callers can never draw the same value. The first use of a scope inserts
 * the row with `INSERT … ON CONFLICT DO NOTHING` (a concurrent first use simply finds the row afterwards). No statement
 * here can FAIL inside the caller's transaction - important on Postgres, where one failed statement aborts the whole
 * transaction (a create-then-catch-the-unique-violation pattern would poison it).
 */
import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { originalCompanyId } from '@/lib/tenant-context'
import { companyKey } from '@/lib/tenant'

// Loose type: works with the prisma singleton and with an interactive $transaction client (same convention as
// lib/bill-reference.ts / lib/stock.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type CounterTable = 'BillSequenceCounter' | 'ExpenseRequestSequence'

const TABLES: Record<CounterTable, { model: string; col: 'lastValue' | 'lastNumber' }> = {
  BillSequenceCounter: { model: 'billSequenceCounter', col: 'lastValue' },
  ExpenseRequestSequence: { model: 'expenseRequestSequence', col: 'lastNumber' },
}

export interface CounterRef {
  companyId: string
  scopeKey: string
  /** default BillSequenceCounter */
  table?: CounterTable
}

const isNotFound = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025'

/** Atomic increment of an existing counter row; null when the company has no row for this scope yet. */
async function bump(db: Db, ref: CounterRef): Promise<number | null> {
  const t = TABLES[ref.table ?? 'BillSequenceCounter']
  try {
    const row = await db[t.model].update({
      where: { companyId_scopeKey: { companyId: ref.companyId, scopeKey: ref.scopeKey } },
      data: { [t.col]: { increment: 1 } },
    })
    return row[t.col] as number
  } catch (e) {
    if (isNotFound(e)) return null
    throw e
  }
}

/** Insert the counter row at `start` unless one already exists (never fails; works on Postgres and SQLite). */
async function insertIfAbsent(db: Db, ref: CounterRef, start: number): Promise<void> {
  const id = randomUUID()
  // updatedAt: Prisma's @updatedAt has no database default; the increment that always follows rewrites it.
  if ((ref.table ?? 'BillSequenceCounter') === 'BillSequenceCounter') {
    await db.$executeRaw`INSERT INTO "BillSequenceCounter" ("id", "companyId", "scopeKey", "lastValue", "updatedAt") VALUES (${id}, ${ref.companyId}, ${ref.scopeKey}, ${start}, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`
  } else {
    await db.$executeRaw`INSERT INTO "ExpenseRequestSequence" ("id", "companyId", "scopeKey", "lastNumber", "updatedAt") VALUES (${id}, ${ref.companyId}, ${ref.scopeKey}, ${start}, CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`
  }
}

/**
 * Next value of the company's counter for `scopeKey` (1, 2, 3 …). Call it inside the same transaction that writes the
 * numbered document, so a rolled-back document also rolls back its number (no gaps).
 *
 * `seed` is consulted only on the very first use of a scope by a company: the counter starts at the number of documents
 * that company has ALREADY issued under this scope (so switching a `count()+1` generator to a counter continues the
 * existing sequence instead of restarting it).
 */
export async function nextDocNumber(db: Db, ref: CounterRef & { seed?: () => Promise<number> }): Promise<number> {
  const first = await bump(db, ref)
  if (first !== null) return first

  // A counter row written before rows carried a company (NULL company) belongs to the ORIGINAL company: adopt it
  // rather than starting a second sequence beside it. (The deploy backfill normally assigns these already.)
  if (ref.companyId === (await originalCompanyId(prisma))) {
    const t = TABLES[ref.table ?? 'BillSequenceCounter']
    const adopted = await db[t.model].updateMany({ where: { scopeKey: ref.scopeKey, companyId: null }, data: { companyId: ref.companyId } })
    if (adopted.count) {
      const v = await bump(db, ref)
      if (v !== null) return v
    }
  }

  await insertIfAbsent(db, ref, ref.seed ? Math.max(0, Math.floor(await ref.seed())) : 0)
  const v = await bump(db, ref)
  if (v === null) {
    // Only possible while the database-wide scopeKey key still exists (before the 3f contract migration) and ANOTHER
    // company already owns a counter with this scopeKey.
    throw new Error(`Document numbering for "${ref.scopeKey}" is not yet available for this company (pending database migration)`)
  }
  return v
}

/**
 * Like nextDocNumber, but for series that used to be numbered `count()+1` (PO/GRN/TRF, POS orders): the drawn number is
 * checked against the documents already issued, and if it is taken (written meanwhile by an older app version during a
 * deploy, or by an import) the counter is moved past the issued numbers (`seed`) and the next value drawn. Without this a
 * counter that fell behind would collide on every attempt, since the failed transaction also rolls the counter back.
 */
export async function nextFreeDocNumber(
  db: Db,
  ref: CounterRef & { seed: () => Promise<number>; format: (n: number) => string; taken: (docNo: string) => Promise<boolean> },
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const docNo = ref.format(await nextDocNumber(db, ref))
    if (!(await ref.taken(docNo))) return docNo
    await raiseDocCounter(db, ref, await ref.seed())
  }
  throw new Error(`Could not allocate a free document number for "${ref.scopeKey}"`)
}

/** Raise a counter to at least `atLeast` (never lowers it). Used to resynchronise after an unexpected number collision,
 *  e.g. documents written by an older app version that still numbered with count()+1. */
export async function raiseDocCounter(db: Db, ref: CounterRef, atLeast: number): Promise<void> {
  const t = TABLES[ref.table ?? 'BillSequenceCounter']
  await db[t.model].updateMany({
    where: { companyId: ref.companyId, scopeKey: ref.scopeKey, [t.col]: { lt: atLeast } },
    data: { [t.col]: atLeast },
  })
}

/**
 * Which company a new document belongs to (and so whose sequence numbers it): the explicit company, else the company of
 * its outlet, else the current company (`companyKey()`: the session's company, or the original company in scripts/cron).
 */
export async function documentCompanyId(db: Db, opts: { companyId?: string | null; outletId?: string | null }): Promise<string> {
  if (opts.companyId) return opts.companyId
  if (opts.outletId) {
    const o = await db.outlet.findUnique({ where: { id: opts.outletId }, select: { companyId: true } })
    if (o?.companyId) return o.companyId
  }
  return companyKey()
}

/** `where` for "this company's rows" on a table whose companyId is still optional: the original company also owns the
 *  rows not yet assigned a company. */
export async function companyRowsWhere(companyId: string): Promise<Record<string, unknown>> {
  return companyId === (await originalCompanyId(prisma)) ? { OR: [{ companyId }, { companyId: null }] } : { companyId }
}

/** Seed for a `<PREFIX>-<digits>` series: the larger of how many documents exist and the highest number issued, so a
 *  deleted document can never cause a number to be handed out twice. */
export function seedFromIssued(count: number, highest: string | null | undefined, prefix: string): number {
  const n = highest && highest.startsWith(prefix) ? Number(highest.slice(prefix.length)) : NaN
  return Math.max(count, Number.isFinite(n) ? n : 0)
}
