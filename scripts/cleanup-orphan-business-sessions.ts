// One-off cleanup: remove orphaned BusinessSession rows — the denormalized BI
// mirror of DailyCollection (see lib/business-session.ts). When a
// DailyCollection was deleted, its BusinessSession row used to be left behind,
// so dashboards/reports (e.g. Staff Performance) kept showing deleted staff/
// days/loss. A row is orphaned when NO DailyCollection exists for its
// (outletId, date, staffName) — the same key syncBusinessSession upserts on.
//
// Usage: npx tsx scripts/cleanup-orphan-business-sessions.ts
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

async function main() {
  const sessions = await db.businessSession.findMany({
    select: { id: true, outletId: true, date: true, staffName: true },
  })
  console.log(`Scanning ${sessions.length} BusinessSession row(s) for orphans...`)

  const orphanIds: string[] = []
  for (const s of sessions) {
    const match = await prisma.dailyCollection.findFirst({
      where: {
        outletId: s.outletId,
        date: s.date,
        // syncBusinessSession maps a null staffName to 'Unassigned'
        ...(s.staffName === 'Unassigned' ? {} : { staffName: s.staffName }),
      },
      select: { id: true },
    })
    if (!match) {
      orphanIds.push(s.id)
      console.log(`  ORPHAN: ${s.staffName} @ ${s.outletId} on ${new Date(s.date).toISOString().slice(0, 10)}`)
    }
  }

  if (orphanIds.length === 0) {
    console.log('No orphaned BusinessSession rows found.')
    return
  }

  const res = await db.businessSession.deleteMany({ where: { id: { in: orphanIds } } })
  console.log(`Deleted ${res.count} orphaned BusinessSession row(s).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
