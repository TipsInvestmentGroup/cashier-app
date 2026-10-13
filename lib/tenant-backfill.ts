import { TENANT_ROOTS, type RootDerive } from '@/lib/tenancy-registry'

/**
 * Phase 3 backfill: give every existing row of every tenant-root table its owning company.
 *
 * Idempotent and fill-only (it only ever touches rows whose companyId IS NULL), so it is safe to run on every
 * deploy and to re-run after an interruption. Uses plain SQL - double-quoted identifiers, correlated
 * subqueries, no vendor functions - so the same statements run on Postgres (production) and SQLite (dev).
 * Table names come from lib/tenancy-registry.ts (constants), never from input.
 *
 * Derivation (see the registry for the full list):
 *   outlet   company of the row's outlet; a row with no (or an unknown / company-less) outlet belongs to the
 *            ORIGINAL company - which is exactly where the old "default company" fallbacks already put it
 *   journal / bill / account / user   from the parent row, same fallback
 *   global   shared masters/config/counters -> the original company
 *
 * `apply:false` only counts what WOULD be assigned. Rows assigned by the fallback (no resolvable outlet/parent)
 * are reported separately as `viaFallback` so they can be reviewed before the NOT NULL step.
 */

// Minimal structural type of the Prisma client we need (works for the extended client and a tx client).
export interface RawDb {
  $queryRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<number>
  company: { findFirst: (args: { orderBy: { createdAt: 'asc' }; select: { id: true } }) => Promise<{ id: string } | null> }
}

export interface TableReport {
  table: string
  derive: RootDerive
  /** rows that had no company before this run */
  nullBefore: number
  /** rows given a company by a precise derivation (outlet / parent) */
  viaOwner: number
  /** rows given the original company because nothing more specific could be resolved */
  viaFallback: number
  /** rows still without a company after this run (should be 0 when applied) */
  nullAfter: number
  skipped?: string
}

export interface BackfillRootsReport {
  defaultCompanyId: string | null
  tables: TableReport[]
  totalAssigned: number
  totalFallback: number
  totalRemaining: number
}

const q = (id: string) => `"${id}"`
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

async function countNull(db: RawDb, table: string): Promise<number> {
  const rows = (await db.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${q('companyId')} IS NULL`)) as { n: number | bigint }[]
  return Number(rows[0]?.n ?? 0)
}

/** SQL scalar subquery yielding the owning company for `derive`, correlated to table alias `t`. */
function ownerSubquery(derive: RootDerive, table: string): string | null {
  const t = q(table)
  switch (derive) {
    case 'outlet':
      return `(SELECT o."companyId" FROM "Outlet" o WHERE o."id" = ${t}."outletId")`
    case 'journal':
      return `(SELECT e."companyId" FROM "JournalEntry" e WHERE e."id" = ${t}."journalEntryId")`
    case 'bill':
      return `(SELECT o."companyId" FROM "SignedBill" s JOIN "Outlet" o ON o."id" = s."outletId" WHERE s."id" = ${t}."signedBillId")`
    case 'account':
      return `(SELECT a."companyId" FROM "CompanyPaymentAccount" a WHERE a."id" = ${t}."companyPaymentAccountId")`
    case 'user':
      return `(SELECT m."companyId" FROM "Membership" m WHERE m."userId" = ${t}."userId" ORDER BY m."createdAt" ASC LIMIT 1)`
    case 'global':
      return null
  }
}

export async function backfillTenantRoots(db: RawDb, opts: { apply: boolean }): Promise<BackfillRootsReport> {
  const original = (await db.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? null
  const report: BackfillRootsReport = { defaultCompanyId: original, tables: [], totalAssigned: 0, totalFallback: 0, totalRemaining: 0 }
  if (!original) return report

  for (const [table, derive] of Object.entries(TENANT_ROOTS)) {
    const row: TableReport = { table, derive, nullBefore: 0, viaOwner: 0, viaFallback: 0, nullAfter: 0 }
    try {
      row.nullBefore = await countNull(db, table)
      const none = `${q('companyId')} IS NULL`
      if (row.nullBefore > 0 && derive === 'global') {
        // shared masters: by design they all belong to the original company today
        row.viaOwner = row.nullBefore
        if (opts.apply) await db.$executeRawUnsafe(`UPDATE ${q(table)} SET ${q('companyId')} = ${lit(original)} WHERE ${none}`)
      } else if (row.nullBefore > 0) {
        const owner = ownerSubquery(derive, table)!
        const precise = `${none} AND ${owner} IS NOT NULL`
        if (opts.apply) {
          // 1. precise: the company of the outlet / parent, wherever that resolves to a company
          await db.$executeRawUnsafe(`UPDATE ${q(table)} SET ${q('companyId')} = ${owner} WHERE ${precise}`)
          // 2. fallback: whatever is left (no outlet, unknown outlet, company-less outlet) -> original company
          const left = await countNull(db, table)
          row.viaOwner = row.nullBefore - left
          row.viaFallback = left
          if (left > 0) await db.$executeRawUnsafe(`UPDATE ${q(table)} SET ${q('companyId')} = ${lit(original)} WHERE ${none}`)
        } else {
          const rows = (await db.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM ${q(table)} WHERE ${precise}`)) as { n: number | bigint }[]
          row.viaOwner = Number(rows[0]?.n ?? 0)
          row.viaFallback = row.nullBefore - row.viaOwner
        }
      }
      row.nullAfter = opts.apply ? await countNull(db, table) : row.nullBefore
    } catch (err) {
      // e.g. the expand migration has not been applied to this database yet: nothing to backfill
      row.skipped = err instanceof Error ? err.message.split('\n')[0].slice(0, 120) : 'error'
    }
    report.tables.push(row)
    report.totalAssigned += row.viaOwner + row.viaFallback
    report.totalFallback += row.viaFallback
    if (!row.skipped) report.totalRemaining += row.nullAfter
  }
  return report
}
