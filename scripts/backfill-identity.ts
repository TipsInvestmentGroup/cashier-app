// #122(a) — Attribute records to a stable Person / Outlet identity.
//
// Conservative + deterministic: it only links a record when there is EXACTLY
// ONE active Person with a matching (trimmed, case-insensitive) name — it never
// creates a Person and never fuzzy-matches, so it can't fragment or mis-merge
// the customer/receivables list. Anything ambiguous (no match, or several) is
// left as-is and reported for manual handling (the NOT-NULL tightening and the
// resolve-person threshold fix are the deferred phase (b)).
//
//   A) ExpenseRequest.outletId ← the requester's outlet (fallback: fund outlet)
//   B) Employee.personId       ← exact-name Person (via the linked User's name)
//   C) Request-bill personId   ← exact-name Person, then repair creditAccountId
//      and re-sync the credit ledger so the receivable is attributable.
//
// Usage:
//   npx tsx scripts/backfill-identity.ts            # apply
//   npx tsx scripts/backfill-identity.ts --dry-run  # report only
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { resolveCreditTags } from '../lib/credit-config'
import { syncCreditForBill } from '../lib/credit-ledger'
import { CREDIT_BILL_TYPES } from '../lib/bill-types'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url) ? new PrismaPg({ connectionString: url }) : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)
const DRY = process.argv.includes('--dry-run')
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

async function main() {
  // One index of active persons by normalised name → [ids].
  const persons = await prisma.person.findMany({ where: { isActive: true }, select: { id: true, name: true } })
  const byName = new Map<string, string[]>()
  for (const p of persons) { const k = norm(p.name); if (!byName.has(k)) byName.set(k, []); byName.get(k)!.push(p.id) }
  const uniqueMatch = (name: string | null | undefined): string | null => {
    const ids = byName.get(norm(name)) || []
    return ids.length === 1 ? ids[0] : null
  }

  // ── A) ExpenseRequest.outletId ──
  const reqs = await prisma.expenseRequest.findMany({ where: { outletId: null }, select: { id: true, requestedById: true, fundingSourceId: true } })
  let aSet = 0, aSkip = 0
  for (const r of reqs) {
    const requester = r.requestedById ? await prisma.user.findUnique({ where: { id: r.requestedById }, select: { outletId: true } }) : null
    const fund = !requester?.outletId && r.fundingSourceId ? await prisma.fundingSource.findUnique({ where: { id: r.fundingSourceId }, select: { outletId: true } }) : null
    const outletId = requester?.outletId || fund?.outletId || null
    if (!outletId) { aSkip++; continue }
    if (!DRY) await prisma.expenseRequest.update({ where: { id: r.id }, data: { outletId } })
    aSet++
  }
  console.log(`[A] ExpenseRequest.outletId: ${DRY ? 'would set' : 'set'} ${aSet}, ${aSkip} unresolved (${reqs.length} were null)`)

  // ── B) Employee.personId (via the linked User's name) ──
  const emps = await prisma.employee.findMany({ where: { personId: null, userId: { not: null } }, select: { id: true, userId: true } })
  let bSet = 0, bSkip = 0
  for (const e of emps) {
    const u = await prisma.user.findUnique({ where: { id: e.userId! }, select: { name: true } })
    const pid = uniqueMatch(u?.name)
    if (!pid) { bSkip++; continue }
    if (!DRY) await prisma.employee.update({ where: { id: e.id }, data: { personId: pid } })
    bSet++
  }
  console.log(`[B] Employee.personId: ${DRY ? 'would link' : 'linked'} ${bSet}, ${bSkip} left for manual review (${emps.length} were null)`)

  // ── C) Request-bill personId (credit-bearing SignedBills) ──
  const bills = await prisma.signedBill.findMany({
    where: { personId: null, billType: { in: [...CREDIT_BILL_TYPES] } },
    select: { id: true, personName: true, billType: true, outletId: true },
  })
  let cSet = 0, cSkip = 0
  for (const b of bills) {
    const pid = uniqueMatch(b.personName)
    if (!pid) { cSkip++; continue }
    if (!DRY) {
      const tags = await resolveCreditTags(prisma as never, { billType: b.billType, personId: pid, outletId: b.outletId })
      await prisma.signedBill.update({ where: { id: b.id }, data: { personId: pid, creditGroupId: tags.creditGroupId, creditAccountId: tags.creditAccountId } })
      await syncCreditForBill(prisma as never, b.id)
    }
    cSet++
  }
  console.log(`[C] Request-bill personId: ${DRY ? 'would link' : 'linked'} ${cSet}, ${cSkip} ambiguous/unmatched (${bills.length} were null)`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
