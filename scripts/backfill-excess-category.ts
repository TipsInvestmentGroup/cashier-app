// One-off backfill for the Collection/Excess redesign: `category` was added
// to ExcessReason/CollectionExcess/CashReconExcess with a schema default of
// 'NON_PAYABLE'. Every CollectionExcess/CashReconExcess row created before
// this redesign was, by construction, a payable excess (the old engine only
// ever created these rows on over-collection, regardless of reason) — so
// they must be flipped to PAYABLE_EXCESS, not left at the new column's
// default. New rows created after this redesign ships always set `category`
// explicitly at creation time, so this is safe to run exactly once per
// environment and safe to re-run (only touches rows still at the default).
//
// Usage: npx tsx scripts/backfill-excess-category.ts
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

// The only reason codes that could exist on a pre-redesign row.
const LEGACY_CODES = ['KITCHEN_SALES', 'STAFF_TIP', 'CUSTOMER_EXCESS', 'OTHERS', 'UNASSIGNED']

async function main() {
  const [reasons, collectionExcess, cashReconExcess] = await Promise.all([
    prisma.excessReason.updateMany({ where: { code: { in: ['KITCHEN_SALES', 'STAFF_TIP', 'CUSTOMER_EXCESS', 'OTHERS'] } }, data: { category: 'PAYABLE_EXCESS' } }),
    prisma.collectionExcess.updateMany({ where: { reason: { in: LEGACY_CODES }, category: 'NON_PAYABLE' }, data: { category: 'PAYABLE_EXCESS' } }),
    prisma.cashReconExcess.updateMany({ where: { reason: { in: LEGACY_CODES }, category: 'NON_PAYABLE' }, data: { category: 'PAYABLE_EXCESS' } }),
  ])
  console.log(`ExcessReason rows fixed: ${reasons.count}`)
  console.log(`CollectionExcess rows backfilled to PAYABLE_EXCESS: ${collectionExcess.count}`)
  console.log(`CashReconExcess rows backfilled to PAYABLE_EXCESS: ${cashReconExcess.count}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
