// One-time backfill for the Product.category (free text) -> ProductCategory
// (real model) migration — see prisma/schema.prisma's comment on Product.category.
// Reads every distinct non-null Product.category string, upserts a matching
// ProductCategory row, and sets Product.categoryId accordingly. Product.category
// itself is left untouched (still read as a fallback by legacy consumers).
// Safe to re-run — upserts are idempotent and already-migrated products are re-set
// to the same categoryId.
//
// Usage: npx tsx scripts/backfill-product-categories.ts
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { backfillProductCategories } from '../lib/backfill-product-categories'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  const result = await backfillProductCategories(prisma)
  console.log(`Created/updated ${result.categoriesCreated} ProductCategory row(s).`)
  console.log(`Set categoryId on ${result.productsUpdated}/${result.productsTotal} product(s).`)
  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect()
  process.exit(1)
})
