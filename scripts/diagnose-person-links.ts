// READ-ONLY diagnostic for the Personal Ledger / Receivable Summary work.
//
// The Person master + SignedBill.personId / PaidBill.personId FKs already exist,
// but both are nullable and shadowed by required free-text name fields
// (personName / payerName). Per-person aggregation is only trustworthy once
// those FKs are populated. This script measures the gap BEFORE any backfill:
//   - how many signed/paid bills have a null personId,
//   - broken down by billType,
//   - and — for the null rows — how cleanly the existing fuzzy matcher
//     (lib/nameMatch.ts, the same one resolve-person.ts uses at write time)
//     would resolve each name to a Person of the matching type:
//       exact  → safe to auto-link
//       similar→ needs cashier confirmation (offered, not auto-applied)
//       none   → would create a new Person / go to a review list
//
// Writes NOTHING. Same adapter-by-DATABASE_URL bootstrap as the other scripts.
//
// Usage:
//   npx tsx scripts/diagnose-person-links.ts
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

type Candidate = { id: string; name: string }
type Tally = { total: number; exact: number; similar: number; none: number }
const emptyTally = (): Tally => ({ total: 0, exact: 0, similar: 0, none: 0 })

function classify(name: string, candidates: Candidate[], t: Tally) {
  t.total++
  const r = findBestPersonMatch(name, candidates)
  if (r.kind === 'exact') t.exact++
  else if (r.kind === 'similar') t.similar++
  else t.none++
}

function pct(n: number, d: number) {
  return d === 0 ? '—' : `${((n / d) * 100).toFixed(0)}%`
}

async function main() {
  console.log(`\n🔍 Person-link diagnostic (READ-ONLY) — db: ${url}\n${'='.repeat(64)}`)

  // Persons grouped by type — the candidate pool the matcher scans.
  const persons = await prisma.person.findMany({ select: { id: true, name: true, type: true } })
  const byType = new Map<string, Candidate[]>()
  for (const p of persons) {
    const key = (p.type || '').toUpperCase()
    if (!byType.has(key)) byType.set(key, [])
    byType.get(key)!.push({ id: p.id, name: p.name })
  }
  console.log(`Persons: ${persons.length} total across ${byType.size} type(s): ` +
    [...byType.entries()].map(([t, c]) => `${t}=${c.length}`).join(', '))

  // ---- SignedBill ----
  const signed = await prisma.signedBill.findMany({
    select: { id: true, billType: true, personId: true, personName: true },
  })
  const sNull = signed.filter((b) => !b.personId)
  console.log(`\nSIGNED BILLS: ${signed.length} total, ${sNull.length} with NULL personId (${pct(sNull.length, signed.length)})`)

  const sByType = new Map<string, { total: number; nul: number; tally: Tally }>()
  for (const b of signed) {
    const key = (b.billType || 'UNKNOWN').toUpperCase()
    if (!sByType.has(key)) sByType.set(key, { total: 0, nul: 0, tally: emptyTally() })
    const row = sByType.get(key)!
    row.total++
    if (!b.personId) {
      row.nul++
      classify(b.personName, byType.get(key) || [], row.tally)
    }
  }
  console.log(`\n  billType        rows   null   | of null →  exact  similar   none`)
  console.log(`  ${'-'.repeat(66)}`)
  for (const [type, r] of [...sByType.entries()].sort()) {
    console.log(
      `  ${type.padEnd(14)}${String(r.total).padStart(6)}${String(r.nul).padStart(7)}   | ` +
      `${String(r.tally.exact).padStart(12)}${String(r.tally.similar).padStart(9)}${String(r.tally.none).padStart(7)}`,
    )
  }

  // ---- PaidBill ---- (payerCategory label → billType code via the report map)
  const paid = await prisma.paidBill.findMany({
    select: { id: true, payerCategory: true, personId: true, payerName: true },
  })
  const pNull = paid.filter((b) => !b.personId)
  console.log(`\nPAID BILLS: ${paid.length} total, ${pNull.length} with NULL personId (${pct(pNull.length, paid.length)})`)

  const paidTally = emptyTally()
  for (const b of pNull) {
    const code = b.payerCategory ? (PAID_BILL_CATEGORY_MAP[b.payerCategory] || b.payerCategory.toUpperCase()) : ''
    // Prefer the mapped type's pool; fall back to scanning ALL persons so we
    // still get a realistic "would this name resolve at all" signal.
    const pool = byType.get(code) || persons.map((p) => ({ id: p.id, name: p.name }))
    classify(b.payerName, pool, paidTally)
  }
  console.log(`  of null → exact=${paidTally.exact}  similar=${paidTally.similar}  none=${paidTally.none}`)

  // ---- Verdict ----
  const sExact = [...sByType.values()].reduce((a, r) => a + r.tally.exact, 0)
  const sSimilar = [...sByType.values()].reduce((a, r) => a + r.tally.similar, 0)
  const sNone = [...sByType.values()].reduce((a, r) => a + r.tally.none, 0)
  console.log(`\n${'='.repeat(64)}\nBACKFILL OUTLOOK (signed bills):`)
  console.log(`  auto-linkable now (exact)      : ${sExact} / ${sNull.length}  (${pct(sExact, sNull.length)})`)
  console.log(`  needs confirmation (similar)   : ${sSimilar}  (${pct(sSimilar, sNull.length)})`)
  console.log(`  new person / review (none)     : ${sNone}  (${pct(sNone, sNull.length)})`)
  console.log(`\nGuidance: if NULLs are ~0, the FK is effectively already enforced and`)
  console.log(`Task 1 is a no-op. If exact% is high, a safe auto-backfill clears most`)
  console.log(`of it; the 'similar'/'none' remainder is the true manual-review workload`)
  console.log(`that decides whether personId NOT NULL can be enforced yet.\n`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
