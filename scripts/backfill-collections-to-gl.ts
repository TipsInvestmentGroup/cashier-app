// #111 — Post historical Daily Collections that were recorded BEFORE collections
// posted to the General Ledger. The primary revenue of the business was sitting
// off the books (the audit found ~TSh 413k across 9 rows in dev, with Cash even
// negative because expenses posted while the offsetting collections did not).
//
// Reconstructs each collection's cash-in from stored data (cash + per-channel
// amounts via channelAmountsFor; the payable portion of any over-collection from
// its CollectionExcess rows) and posts through lib/collection-gl.ts —
// the SAME function the live POST route uses, so backfilled entries are
// identical to new ones. Idempotent: postCollectionCashIn no-ops when a
// non-reversed COLLECTIONS entry already exists, so it is safe to re-run.
//
// Bootstraps its own Prisma client (adapter-by-DATABASE_URL, like prisma/seed.ts).
//
// Usage:
//   npx tsx scripts/backfill-collections-to-gl.ts            # apply
//   npx tsx scripts/backfill-collections-to-gl.ts --dry-run  # report only
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { postCollectionCashIn } from '../lib/collection-gl'
import { channelAmountsFor } from '../lib/collection-channels-shared'
import { classForReason } from '../lib/reconciliation-classification'
import { resolveDefaultCompanyId } from '../lib/finance-mapping'
import { roundMoney } from '../lib/utils'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  // Collections that already have a live COLLECTIONS entry — skip those.
  const posted = new Set(
    (await prisma.journalEntry.findMany({ where: { sourceType: 'DailyCollection', status: { not: 'REVERSED' } }, select: { sourceId: true } }))
      .map((j) => j.sourceId)
      .filter((s): s is string => !!s),
  )

  const collections = await prisma.dailyCollection.findMany({
    include: { outlet: { select: { companyId: true } }, channels: { select: { channelCode: true, amount: true } } },
    orderBy: { date: 'asc' },
  })
  const todo = collections.filter((c) => !posted.has(c.id) && roundMoney(c.total) > 0)
  console.log(`[backfill] ${collections.length} collections, ${todo.length} unposted with total > 0`)

  let done = 0, skipped = 0, failed = 0
  for (const c of todo) {
    const companyId = c.outlet?.companyId || (await resolveDefaultCompanyId(prisma as never))
    if (!companyId || !c.outletId) { skipped++; console.warn(`  skip ${c.id}: no company/outlet`); continue }

    const channelAmounts = channelAmountsFor(c)
    const amountsByCode = { CASH: roundMoney(c.cash || 0), ...channelAmounts }
    const excess = await prisma.collectionExcess.findMany({ where: { collectionId: c.id }, select: { amount: true, reason: true, category: true } })
    const payableExcessForGl = roundMoney(excess.reduce((s, e) => s + (classForReason(e.reason, e.category) === 'PAYABLE' ? e.amount : 0), 0))

    if (DRY_RUN) { done++; continue }
    try {
      const r = await prisma.$transaction((tx) => postCollectionCashIn(tx as never, {
        companyId, collectionId: c.id, outletId: c.outletId, entryDate: c.date, createdById: c.cashierId || 'system',
        amountsByCode, total: roundMoney(c.total), payableExcessForGl,
      }))
      if (r.posted) done++; else skipped++
    } catch (e) {
      failed++
      console.error(`  FAIL ${c.id} (${roundMoney(c.total)}): ${(e as Error).message}`)
    }
  }

  console.log(`\n[backfill] ${DRY_RUN ? 'would post' : 'posted'} ${done}; skipped ${skipped}; failed ${failed}.`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
