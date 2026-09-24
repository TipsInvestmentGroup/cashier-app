// #116 — Add the SDL & WCF employer levies to an existing deployment.
//
// Re-runs the payroll framework seed, which is idempotent: it create-only /
// upserts, so it ONLY adds the new SDL & WCF StatutoryRule rows, the SDL_ER /
// WCF_ER EMPLOYER_CONTRIBUTION components, and their pay-group assignments,
// leaving every existing rule, component, employee and assignment untouched.
// The 2360 SDL Payable / 2370 WCF Payable accounts auto-heal into the chart on
// first posting via ensureChartOfAccounts.
//
// After running, every future payroll run computes SDL (3.5%) and WCF (0.5%) on
// gross as employer cost and posts Dr Employer Contributions / Cr the payable.
// CONFIRM the rates and your SDL exemption status first — they are editable
// StatutoryRule rows (Setup → Payroll → Statutory), no code change needed.
//
// Usage:  npx tsx scripts/backfill-sdl-wcf.ts
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { seedPayrollFramework } from '../lib/payroll-seed'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url) ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

async function main() {
  const r = await seedPayrollFramework(prisma)
  console.log(`[backfill] payroll seed reconciled — ${r.statutoryRules} statutory rules, ${r.components} components, ${r.assignments} new assignments. SDL & WCF are now in place.`)
}
main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
