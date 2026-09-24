// One-time REPORT (writes nothing): lists existing OUT expense requests that
// have no expenseType yet — Phase 3 introduced that dimension, so every
// pre-Phase-3 row is null — so someone can assign the correct transaction type
// by hand. Per the spec, rows are FLAGGED for manual review, never auto-guessed:
// there is no safe way to infer "Allowance vs Purchase vs Repair" from the
// existing data.
//
// It highlights the specific duplication the spec calls out — rows whose
// Request Type name and Category name are identical (the "both columns show
// Allowance" case) — since those are the ones where the old two columns carried
// no real second dimension at all.
//
//   npx tsx scripts/flag-expense-type-backfill.ts
//
// Read-only: safe to run against production any time.
import { prisma } from '@/lib/prisma'

async function main() {
  const rows = await prisma.expenseRequest.findMany({
    where: { direction: 'OUT', expenseType: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, requestNumber: true, purpose: true, createdAt: true,
      requestType: { select: { name: true } },
      category: { select: { name: true } },
      outlet: { select: { name: true } },
    },
  })

  console.log(`OUT expense requests with no expenseType (need manual assignment): ${rows.length}\n`)
  if (!rows.length) { console.log('Nothing to flag.'); return }

  const dupes = rows.filter((r) => r.requestType.name.trim().toLowerCase() === r.category.name.trim().toLowerCase())

  console.log(`Of these, ${dupes.length} have Type == Category (the duplication the spec flags — assign a real expense type here first):\n`)
  for (const r of dupes) {
    console.log(`  ⚠  ${r.requestNumber || r.id.slice(0, 8)} · ${r.outlet?.name || 'no outlet'} · "${r.purpose}" · Type=Category="${r.category.name}"`)
  }

  const rest = rows.filter((r) => !dupes.includes(r))
  if (rest.length) {
    console.log(`\nThe remaining ${rest.length} have distinct Type/Category but still no expenseType:\n`)
    for (const r of rest) {
      console.log(`  •  ${r.requestNumber || r.id.slice(0, 8)} · ${r.outlet?.name || 'no outlet'} · "${r.purpose}" · ${r.requestType.name} / ${r.category.name}`)
    }
  }

  console.log('\nThis script writes nothing. Assign expenseType per row in the app (or via a reviewed follow-up script) once the correct kinds are confirmed.')
}

main().catch((e) => { console.error(e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
