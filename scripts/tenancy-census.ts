// Verification gate for the multi-company "contract" step: how many rows in tenant-owned tables still have no
// company, and how many were only assigned by the fallback (no resolvable outlet/parent)?
//
//   READ-ONLY by default (counts what a backfill WOULD do):
//     DATABASE_URL=<target db url> npx tsx scripts/tenancy-census.ts
//   Apply the idempotent backfill, then re-count (the deploy seed does this on every deploy):
//     DATABASE_URL=<target db url> npx tsx scripts/tenancy-census.ts --apply
//
// Exit code 0 = every row is assigned (safe to start the NOT NULL / FK / unique-key contract). 1 = work remains.
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import { backfillTenantRoots } from '../lib/tenant-backfill'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const isPg = /^postgres(ql)?:\/\//.test(url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter: isPg ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url }) } as any)
const apply = process.argv.includes('--apply')

async function main() {
  console.log(`Target: ${isPg ? 'postgres (remote)' : url}   mode: ${apply ? 'APPLY' : 'read-only'}\n`)
  const r = await backfillTenantRoots(prisma as never, { apply })
  if (!r.defaultCompanyId) { console.log('No company exists yet - nothing to assign.'); return }
  console.log(`Original company: ${r.defaultCompanyId}\n`)
  console.log('table'.padEnd(26) + 'nullBefore  byOwner  byFallback  nullAfter')
  for (const t of r.tables) {
    if (t.skipped) { console.log(t.table.padEnd(26) + `SKIPPED: ${t.skipped}`); continue }
    if (t.nullBefore === 0 && t.nullAfter === 0) continue
    console.log(t.table.padEnd(26) + String(t.nullBefore).padStart(10) + String(t.viaOwner).padStart(9) + String(t.viaFallback).padStart(12) + String(t.nullAfter).padStart(11))
  }
  const skipped = r.tables.filter((t) => t.skipped).length
  console.log(`\nassigned this run: ${r.totalAssigned}   via fallback (review): ${r.totalFallback}   still unassigned: ${r.totalRemaining}   tables skipped: ${skipped}`)
  if (r.totalRemaining > 0 || skipped > 0) { console.log(apply ? 'NOT READY: rows remain or tables are missing the column.' : 'Run with --apply (or deploy) to assign them.'); process.exitCode = 1 }
  else console.log('READY: every tenant-owned row has a company.')
}
main().catch((e) => { console.error(e); process.exit(2) }).finally(() => prisma.$disconnect())
