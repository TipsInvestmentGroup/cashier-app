// One-time (resumable, idempotent) backfill of the Universal Credit Framework
// tags onto historical SignedBills: creditGroupId (from billType via the group's
// legacyBillTypeCode) and creditAccountId (from personId via CreditAccount). New
// bills are tagged at creation (see the resolveCreditTags call sites); this
// closes the gap for rows created before that wiring shipped.
//
// Bootstraps its own Prisma client with the same adapter-selection-by-
// DATABASE_URL pattern as prisma/seed.ts, so it runs outside the Next.js server.
//
// Usage:
//   npx tsx scripts/backfill-credit-tags.ts [--dry-run]
//
//   --dry-run   Report what WOULD be tagged, writing nothing.
//
// Safe to re-run: only rows still missing a tag are considered, and each row is
// updated only for the field(s) that resolve to a value.
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
  console.log(`🏷️  Backfilling credit tags${DRY_RUN ? ' (DRY RUN — no writes)' : ''}…`)

  // Build billType → creditGroupId map (per company) once. Single-company today,
  // but keyed by companyId to stay correct if more companies are added.
  const groups = await prisma.creditGroup.findMany({ where: { status: 'ACTIVE' }, select: { id: true, companyId: true, legacyBillTypeCode: true } })
  const groupByCompanyLegacy = new Map<string, string>()
  for (const g of groups) {
    if (g.legacyBillTypeCode) groupByCompanyLegacy.set(`${g.companyId}:${g.legacyBillTypeCode}`, g.id)
  }

  // personId → creditAccountId map.
  const accounts = await prisma.creditAccount.findMany({ where: { personId: { not: null } }, select: { id: true, personId: true } })
  const accountByPerson = new Map<string, string>()
  for (const a of accounts) if (a.personId) accountByPerson.set(a.personId, a.id)

  // Cache the company per outlet so we don't refetch per bill.
  const outlets = await prisma.outlet.findMany({ select: { id: true, companyId: true } })
  const companyByOutlet = new Map<string, string | null>()
  for (const o of outlets) companyByOutlet.set(o.id, o.companyId)
  const defaultCompany = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })

  const bills = await prisma.signedBill.findMany({
    where: { OR: [{ creditGroupId: null }, { creditAccountId: null }] },
    select: { id: true, billType: true, personId: true, outletId: true, creditGroupId: true, creditAccountId: true },
  })
  console.log(`Found ${bills.length} bill(s) missing at least one tag.`)

  let groupTagged = 0
  let accountTagged = 0
  let updated = 0
  for (const b of bills) {
    const companyId = companyByOutlet.get(b.outletId) || defaultCompany?.id || null
    const data: { creditGroupId?: string; creditAccountId?: string } = {}

    if (!b.creditGroupId && companyId) {
      const gid = groupByCompanyLegacy.get(`${companyId}:${b.billType}`)
      if (gid) { data.creditGroupId = gid; groupTagged++ }
    }
    if (!b.creditAccountId && b.personId) {
      const aid = accountByPerson.get(b.personId)
      if (aid) { data.creditAccountId = aid; accountTagged++ }
    }

    if (Object.keys(data).length === 0) continue
    updated++
    if (!DRY_RUN) await prisma.signedBill.update({ where: { id: b.id }, data })
  }

  console.log(`\n${DRY_RUN ? 'WOULD update' : 'Updated'} ${updated} bill(s): +${groupTagged} group tags, +${accountTagged} account tags.`)
  if (DRY_RUN) console.log('Re-run without --dry-run to apply.')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
