// One-time (resumable, idempotent) backfill of SignedBill.personId /
// PaidBill.personId from the required free-text name fields (personName /
// payerName), so per-person aggregation in the Receivable Summary + Personal
// Ledger is trustworthy. The Person master + FKs already exist; this closes the
// gap for rows created before the person-picker wiring, exactly like
// scripts/backfill-credit-tags.ts did for credit tags.
//
// Matching reuses the SAME fuzzy matcher used at write time
// (lib/nameMatch.ts findBestPersonMatch), scoped to Persons of the matching
// type (Person.type === billType code; PaidBill maps payerCategory → code):
//   exact   → auto-linked (safe).
//   similar → linked ONLY with --link-similar; otherwise logged for review.
//   none    → logged for review; never auto-created here (write-time
//             resolvePerson still auto-creates for NEW entries).
//
// Run the read-only scripts/diagnose-person-links.ts FIRST to see the split.
//
// Usage:
//   npx tsx scripts/backfill-person-links.ts [--dry-run] [--link-similar]
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { findBestPersonMatch } from '@/lib/nameMatch'
import { PAID_BILL_CATEGORY_MAP } from '@/lib/bill-types'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')
const LINK_SIMILAR = process.argv.includes('--link-similar')

type Candidate = { id: string; name: string }
type Review = { table: string; id: string; name: string; type: string; kind: string; suggestion?: string; score?: number }

async function main() {
  console.log(`🔗 Backfilling person links${DRY_RUN ? ' (DRY RUN — no writes)' : ''}${LINK_SIMILAR ? ' [+link similar]' : ''}…\n`)

  const persons = await prisma.person.findMany({ select: { id: true, name: true, type: true } })
  const byType = new Map<string, Candidate[]>()
  for (const p of persons) {
    const k = (p.type || '').toUpperCase()
    if (!byType.has(k)) byType.set(k, [])
    byType.get(k)!.push({ id: p.id, name: p.name })
  }

  const review: Review[] = []
  let linked = 0
  let skipped = 0

  // ---- SignedBill (type = billType code) ----
  const signed = await prisma.signedBill.findMany({
    where: { personId: null },
    select: { id: true, billType: true, personName: true },
  })
  for (const b of signed) {
    const type = (b.billType || '').toUpperCase()
    const r = findBestPersonMatch(b.personName, byType.get(type) || [])
    if (r.kind === 'exact' || (r.kind === 'similar' && LINK_SIMILAR)) {
      linked++
      if (!DRY_RUN) await prisma.signedBill.update({ where: { id: b.id }, data: { personId: r.match.id } })
    } else {
      skipped++
      review.push({
        table: 'SignedBill', id: b.id, name: b.personName, type, kind: r.kind,
        suggestion: r.kind === 'similar' ? r.match.name : undefined,
        score: r.kind === 'similar' ? Number(r.score.toFixed(2)) : undefined,
      })
    }
  }

  // ---- PaidBill (type from payerCategory label → billType code) ----
  const paid = await prisma.paidBill.findMany({
    where: { personId: null },
    select: { id: true, payerCategory: true, payerName: true },
  })
  for (const b of paid) {
    const type = b.payerCategory ? (PAID_BILL_CATEGORY_MAP[b.payerCategory] || b.payerCategory.toUpperCase()) : ''
    const pool = byType.get(type) || persons.map((p) => ({ id: p.id, name: p.name }))
    const r = findBestPersonMatch(b.payerName, pool)
    if (r.kind === 'exact' || (r.kind === 'similar' && LINK_SIMILAR)) {
      linked++
      if (!DRY_RUN) await prisma.paidBill.update({ where: { id: b.id }, data: { personId: r.match.id } })
    } else {
      skipped++
      review.push({
        table: 'PaidBill', id: b.id, name: b.payerName, type, kind: r.kind,
        suggestion: r.kind === 'similar' ? r.match.name : undefined,
        score: r.kind === 'similar' ? Number(r.score.toFixed(2)) : undefined,
      })
    }
  }

  console.log(`${DRY_RUN ? 'WOULD link' : 'Linked'}: ${linked}   |   left for review: ${skipped}\n`)
  if (review.length) {
    console.log('REVIEW (not auto-linked) — resolve these manually or via the person picker:')
    for (const r of review) {
      const hint = r.kind === 'similar' ? ` → similar to "${r.suggestion}" (${r.score})` : ' → no confident match'
      console.log(`  [${r.table}] ${r.id}  "${r.name}" (${r.type})${hint}`)
    }
    if (!LINK_SIMILAR && review.some((r) => r.kind === 'similar')) {
      console.log('\nRe-run with --link-similar to also apply the "similar" suggestions above.')
    }
  }
  console.log(`\nAfter review reaches zero, personId can be enforced NOT NULL in a follow-up migration.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
