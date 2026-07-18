// One-off backfill: create the standardized BusinessSession row (see
// lib/business-session.ts) for every existing DailyCollection, so BI-layer
// trend/comparison insights aren't empty for historical data on rollout.
// Safe to re-run — syncBusinessSession() upserts by [outletId, date, staffName].
//
// Usage: npx tsx scripts/backfill-business-sessions.ts
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { syncBusinessSession } from '../lib/business-session'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  const collections = await prisma.dailyCollection.findMany({ select: { id: true }, orderBy: { date: 'asc' } })
  console.log(`Backfilling BusinessSession for ${collections.length} DailyCollection row(s)...`)

  let done = 0
  for (const c of collections) {
    await syncBusinessSession(prisma, c.id)
    done += 1
    if (done % 50 === 0) console.log(`  ... ${done}/${collections.length}`)
  }

  const bsCount = await (prisma as unknown as { businessSession: { count: () => Promise<number> } }).businessSession.count()
  console.log(`Done — ${done} DailyCollection row(s) processed, ${bsCount} BusinessSession row(s) now exist.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
