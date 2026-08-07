// One-time backfill for the GL chart cleanup (expense-module PDF/GL spec §5-6):
//
//   1. Rename the fund-neutral suspense account IN PLACE for every existing
//      company: old '5940 Petty Cash Expense (unclassified)' -> '9000
//      Unclassified / Suspense Expense'. Renamed (not recreated) so the
//      account keeps its id, history, journal lines and FinanceAccountMapping
//      rows. The internal mappingKey stays PETTY_CASH_EXPENSE (referenced by
//      key, never by code/name), so nothing that posts to it breaks.
//
//   2. Heal the 12 new operating-cost accounts (5300-5830) into every company
//      via ensureChartOfAccounts — the same idempotent, code-keyed heal the
//      app already runs on the first Finance read. Done here too so production
//      has them immediately after deploy instead of waiting for a read.
//
// Idempotent:
//   • If a company already has 9000 (or has no 5940), the rename is skipped.
//   • ensureChartOfAccounts only creates codes that are missing.
// Re-running is a no-op. Pass --dry to preview without writing.
//
//   npx tsx scripts/backfill-gl-suspense-rename.ts [--dry]
//
// Run against production with DATABASE_URL pointed at it, once, after deploy.
import { prisma } from '@/lib/prisma'
import { ensureChartOfAccounts } from '@/lib/finance-mapping'

const OLD_CODE = '5940'
const NEW_CODE = '9000'
const NEW_NAME = 'Unclassified / Suspense Expense'

async function main() {
  const dryRun = process.argv.includes('--dry')
  const companies = await prisma.company.findMany({ select: { id: true, name: true } })
  console.log(`${companies.length} company(ies)\n`)

  let renamed = 0, skipped = 0, healed = 0
  for (const c of companies) {
    // --- 1. Rename 5940 -> 9000 (in place) ---
    const old = await prisma.account.findUnique({
      where: { companyId_code: { companyId: c.id, code: OLD_CODE } },
      select: { id: true, name: true },
    })
    const already9000 = await prisma.account.findUnique({
      where: { companyId_code: { companyId: c.id, code: NEW_CODE } },
      select: { id: true },
    })

    if (old && !already9000) {
      console.log(`  [${c.name}] rename ${OLD_CODE} "${old.name}" -> ${NEW_CODE} "${NEW_NAME}"`)
      if (!dryRun) {
        await prisma.account.update({ where: { id: old.id }, data: { code: NEW_CODE, name: NEW_NAME } })
      }
      renamed++
    } else if (old && already9000) {
      // Both exist — do NOT merge automatically (could move balances). Flag it.
      console.log(`  [${c.name}] ⚠ both ${OLD_CODE} and ${NEW_CODE} exist — left as-is, review manually`)
      skipped++
    } else {
      // No 5940 (new company already seeded with 9000, or never provisioned).
      skipped++
    }

    // --- 2. Heal the 12 new operating accounts ---
    if (!dryRun) {
      const before = await prisma.account.count({ where: { companyId: c.id } })
      await ensureChartOfAccounts(prisma, c.id)
      const after = await prisma.account.count({ where: { companyId: c.id } })
      if (after > before) { console.log(`  [${c.name}] added ${after - before} new default account(s)`); healed += after - before }
    }
  }

  console.log(`\n${dryRun ? '[DRY] would rename' : 'renamed'} ${renamed}, skipped ${skipped}, new accounts added ${healed}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
