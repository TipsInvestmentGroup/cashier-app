// #112 — Map TIPS expense categories to their operating-cost GL accounts so
// category-level spend stops collapsing into the 9000 suspense bucket.
//
// Only sets budgetAccountId where it is still null (never overwrites a mapping
// an operator already chose) and only for categories this table recognises by
// normalised name — anything unrecognised is left unmapped and reported, so an
// operator can classify it deliberately. Fund Top-Up is intentionally NOT a
// P&L expense (it moves cash INTO a fund) and is skipped.
//
// Ensures the chart is seeded first (creates 5340 Cleaning & Consumables and
// 5350 Transport & Delivery on companies that predate them). Idempotent.
//
// Usage:
//   npx tsx scripts/backfill-expense-category-accounts.ts            # apply
//   npx tsx scripts/backfill-expense-category-accounts.ts --dry-run  # report only
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { ensureChartOfAccounts } from '../lib/finance-mapping'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

// Normalised category name (or code) -> target GL account code. null = a known
// category that is deliberately NOT mapped to a P&L account.
const MAP: Record<string, string | null> = {
  'allowance': '5830',                    // Staff Welfare & Meals
  'cleaning supplies — store': '5340',    // Cleaning & Consumables
  'cleaning supplies - store': '5340',    // (hyphen variant)
  'cleaning supplies': '5340',
  'gas refill': '5320',                   // Generator Fuel (generator + cooking, mixed)
  'ice for main store': '5100',           // Purchases Expense (uncosted)
  'purchases of': '5100',
  'purchases': '5100',
  'transport': '5350',                    // Transport & Delivery
  'fund top-up': null,                    // NOT an expense — cash into a fund
  'fund topup': null,
  'fund top up': null,
}

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } })
  let mapped = 0, skippedTopup = 0, unrecognised = 0, alreadySet = 0

  for (const company of companies) {
    await ensureChartOfAccounts(prisma as never, company.id)
    const accounts = await prisma.account.findMany({ where: { companyId: company.id }, select: { id: true, code: true } })
    const byCode = new Map(accounts.map((a) => [a.code, a.id]))

    const cats = await prisma.expenseCategory.findMany({
      where: { companyId: company.id },
      select: { id: true, code: true, name: true, legacyFunctionName: true, budgetAccountId: true },
    })
    for (const c of cats) {
      if (c.budgetAccountId) { alreadySet++; continue }
      const key = [norm(c.name), norm(c.legacyFunctionName ?? ''), norm(c.code)].find((k) => k in MAP)
      if (key === undefined) { unrecognised++; console.log(`  UNRECOGNISED  "${c.name}" (${c.code}) — left unmapped`); continue }
      const targetCode = MAP[key]
      if (targetCode === null) { skippedTopup++; console.log(`  SKIP (not P&L) "${c.name}"`); continue }
      const accountId = byCode.get(targetCode)
      if (!accountId) { console.log(`  MISSING ACCT  ${targetCode} for "${c.name}" — chart not seeded?`); continue }
      console.log(`  ${DRY_RUN ? 'would map' : 'MAP'}      "${c.name}" -> ${targetCode}`)
      if (!DRY_RUN) await prisma.expenseCategory.update({ where: { id: c.id }, data: { budgetAccountId: accountId } })
      mapped++
    }
  }
  console.log(`[backfill] ${DRY_RUN ? 'would map' : 'mapped'} ${mapped}; ${skippedTopup} top-up skipped; ${unrecognised} unrecognised; ${alreadySet} already mapped.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
