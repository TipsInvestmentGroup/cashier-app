// #110 — Book Cost of Goods Sold for sales that relieved stock before
// recordItemPrepared learned to post inventory relief to the GL.
//
// Each SALE StockLedgerEntry (type='SALE', refType='PosOrderItem') decremented
// physical stock but never credited the Inventory asset / debited COGS. Replaying
// postCogsForSale on each now books Dr COGS / Cr Inventory at the product's
// standard cost (buyingPrice):
//   • product with a buyingPrice > 0  -> Dr COGS / Cr Inventory Asset
//   • product with no cost on file    -> skipped (a data gap, reported, not posted)
//
// Safe + idempotent: postCogsForSale no-ops once an item already has a
// (non-reversed) INVENTORY / PosOrderItem entry, so a second run touches nothing.
//
// Bootstraps its own Prisma client (adapter-by-DATABASE_URL, like prisma/seed.ts).
//
// Usage:
//   npx tsx scripts/backfill-cogs.ts            # apply
//   npx tsx scripts/backfill-cogs.ts --dry-run  # report only
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { postCogsForSale } from '../lib/stock'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const sales = await prisma.stockLedgerEntry.findMany({
    where: { type: 'SALE', refType: 'PosOrderItem', refId: { not: null } },
    select: { productId: true, productName: true, outletId: true, quantity: true, refId: true, createdById: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`[backfill] ${sales.length} SALE ledger entr(y/ies) to relieve to COGS`)

  let posted = 0
  let skipped = 0
  for (const s of sales) {
    if (DRY_RUN) continue
    if (!s.outletId) { skipped++; continue } // no outlet -> can't scope the COGS line
    const res = await postCogsForSale(prisma as never, {
      itemId: s.refId!, productId: s.productId, productName: s.productName,
      quantity: Math.abs(s.quantity), outletId: s.outletId,
      userId: s.createdById || 'system', entryDate: s.createdAt,
    })
    if (res.posted) posted++
    else skipped++
  }

  if (DRY_RUN) console.log(`[backfill] dry run — would attempt ${sales.length} sale(s)`)
  else console.log(`[backfill] posted ${posted} COGS entr(y/ies); skipped ${skipped} (already posted / zero-cost product / no company).`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
