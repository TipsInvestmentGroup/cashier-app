// One-time correction: the initial Phase-1 credit seed copied
// Person.creditLimit into CreditAccount.creditLimitOverride, creating a second
// source of truth for the same number (the person limit already flows through
// resolveEffectiveLimit's PERSON source, read live). This nulls those auto-
// copied overrides so an override again means only "an explicit per-account
// override an admin set". Precise: only clears an override that still equals the
// linked person's current creditLimit (the auto-copy signature) — a genuine
// admin override with a different value is left untouched.
//
// Usage: npx tsx scripts/fix-credit-override-dupe.ts [--dry-run]
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
const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const accounts = await prisma.creditAccount.findMany({
    where: { creditLimitOverride: { not: null }, personId: { not: null } },
    select: { id: true, creditLimitOverride: true, person: { select: { creditLimit: true } } },
  })
  let cleared = 0
  for (const a of accounts) {
    if (a.person && a.creditLimitOverride === a.person.creditLimit) {
      cleared++
      if (!DRY_RUN) await prisma.creditAccount.update({ where: { id: a.id }, data: { creditLimitOverride: null } })
    }
  }
  console.log(`${DRY_RUN ? 'WOULD clear' : 'Cleared'} ${cleared} auto-copied override(s) of ${accounts.length} with an override set.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
