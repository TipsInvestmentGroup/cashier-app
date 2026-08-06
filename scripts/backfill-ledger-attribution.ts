// One-time backfill: fill the denormalized `createdByName` on historical Petty
// Cash Ledger rows (FundingSourceTxn) that were written before the Phase 1
// attribution fix — most notably PAYMENT ("Expense paid") rows, which used to
// store createdById but no name, so the ledger's "By" column showed "—".
//
// Rules (never fabricate a name):
//   • createdById present  → snapshot that user's CURRENT name. If the user no
//                            longer exists, fall back to "Unknown (pre-fix)".
//   • createdById missing  → "Unknown (pre-fix)". The id cannot be invented, so
//                            it is left null; the app-layer guard only blocks
//                            NEW writes, not these grandfathered rows.
//
// Idempotent — only touches rows whose createdByName is null/empty, so re-running
// is a no-op. Pass --dry to preview without writing.
//
//   npx tsx scripts/backfill-ledger-attribution.ts [--dry]
//
// Run against production with DATABASE_URL pointed at it, once, after deploy.
import { prisma } from '@/lib/prisma'

const UNKNOWN = 'Unknown (pre-fix)'

async function main() {
  const dryRun = process.argv.includes('--dry')

  const rows = await prisma.fundingSourceTxn.findMany({
    where: { OR: [{ createdByName: null }, { createdByName: '' }] },
    select: { id: true, type: true, createdById: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Ledger rows missing an attribution name: ${rows.length}${dryRun ? '  (dry run — nothing will be written)' : ''}\n`)
  if (!rows.length) return

  // Resolve every referenced user once.
  const userIds = [...new Set(rows.map((r) => r.createdById).filter((id): id is string => !!id))]
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    : []
  const nameById = new Map(users.map((u) => [u.id, u.name]))

  let resolved = 0
  let unknownMissingUser = 0
  let unknownNoId = 0

  for (const r of rows) {
    let name: string
    if (r.createdById) {
      const looked = nameById.get(r.createdById)
      if (looked) { name = looked; resolved++ }
      else { name = UNKNOWN; unknownMissingUser++ }
    } else {
      name = UNKNOWN; unknownNoId++
    }
    if (!dryRun) {
      await prisma.fundingSourceTxn.update({ where: { id: r.id }, data: { createdByName: name } })
    }
  }

  console.log(`  resolved to a real user name:        ${resolved}`)
  console.log(`  "${UNKNOWN}" (user id present, user gone): ${unknownMissingUser}`)
  console.log(`  "${UNKNOWN}" (no acting user recorded):     ${unknownNoId}`)
  console.log(dryRun ? '\nDry run complete — re-run without --dry to apply.' : '\nBackfill complete.')
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
