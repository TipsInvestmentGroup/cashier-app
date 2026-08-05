// One-time backfill: give everyone already assigned to a fund the matching
// CUSTODIAN eligibility grant (§4), so enforcing eligibility on assignment
// (lib/expense-access.ts assignFundingSourceCustodian) does not start rejecting
// people who legitimately hold a fund today.
//
// Idempotent — safe to re-run, and safe to run before or after deploying the
// enforcement, though running it FIRST is the point.
//
//   npx tsx scripts/backfill-custodian-grants.ts
//
// Run against production with DATABASE_URL pointed at it, once, after deploy.
import { prisma } from '@/lib/prisma'
import { backfillCustodianGrants, listGrants } from '@/lib/expense-grants'
import { fundClassOf, FUND_CLASS_LABELS } from '@/lib/expense-funds'

async function main() {
  const sources = await prisma.fundingSource.findMany({
    where: { isActive: true },
    select: { id: true, name: true, sourceType: true, outletId: true, responsibleUserId: true, _count: { select: { custodians: true } } },
    orderBy: { name: 'asc' },
  })

  console.log(`Active funding sources: ${sources.length}\n`)
  for (const s of sources) {
    const fc = fundClassOf(s.sourceType)
    const holders = s._count.custodians + (s.responsibleUserId ? 1 : 0)
    console.log(`  ${s.name} (${s.sourceType}) → ${fc ? FUND_CLASS_LABELS[fc] : 'no fund class — will be skipped'}; ${holders} assigned`)
  }

  console.log('\nBackfilling…')
  const result = await backfillCustodianGrants()
  console.log(`  granted:              ${result.granted}`)
  console.log(`  skipped (no class):   ${result.skippedNoFundClass} funding source(s)`)
  console.log(`  skipped (inactive):   ${result.skippedInactiveUser} user(s)`)

  const companies = await prisma.company.findMany({ select: { id: true, name: true } })
  for (const c of companies) {
    const grants = (await listGrants(c.id)).filter((g) => g.grantType === 'CUSTODIAN')
    if (!grants.length) continue
    console.log(`\nLive custodian grants for ${c.name}:`)
    for (const g of grants) {
      console.log(`  ${g.user?.name || g.userId} → ${FUND_CLASS_LABELS[g.fundClass as keyof typeof FUND_CLASS_LABELS] || g.fundClass} @ ${g.outlet?.name || 'all outlets'}`)
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
