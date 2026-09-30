// Transaction Ledger (Phases 0 & 1) — one-off backfill for data recorded
// before StaffTransaction became the ledger. It never invents transactions:
// Default-form collections saved before this release stay as typed totals
// (ledgerBacked=false, shown as "not itemised"). It only:
//   A) fills outletId / date / staffName on existing staff declarations from
//      their TransactionSession + staff user;
//   B) sets referenceKey on live digital PAYMENT declarations that carry a
//      reference — a reference already claimed by an earlier row is REPORTED
//      and left unset (never silently dropped or merged);
//   C) links each collection that was validated from a Transaction Session to
//      its APPROVED declarations and marks it ledgerBacked — ONLY when the
//      declarations sum exactly to the stored cash/channel figures. Mismatches
//      are reported and left untouched for a human to look at.
// Idempotent — re-running finds nothing left to do.
//
// Usage:
//   npx tsx scripts/backfill-transaction-ledger.ts --dry-run  # report only
//   npx tsx scripts/backfill-transaction-ledger.ts            # apply
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { channelAmountsFor } from '../lib/collection-channels-shared'
import { referenceKeyFor, linkAndLockTransactions } from '../lib/collection-ledger'
import { roundMoney } from '../lib/utils'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')
const TX_SESSION_NOTE = /^Validated from Transaction Session (\S+)/

async function main() {
  console.log(`[ledger-backfill] ${DRY_RUN ? 'DRY RUN — no writes' : 'APPLYING'}`)

  // ── A) denormalize outlet/date/staffName ────────────────────────────────
  const bare = await prisma.staffTransaction.findMany({
    where: { sessionId: { not: null }, OR: [{ outletId: null }, { date: null }, { staffName: null }] },
    include: { session: { select: { outletId: true, date: true } }, staff: { select: { name: true } } },
  })
  for (const t of bare) {
    if (!t.session) continue
    if (!DRY_RUN) {
      await prisma.staffTransaction.update({
        where: { id: t.id },
        data: { outletId: t.outletId ?? t.session.outletId, date: t.date ?? t.session.date, staffName: t.staffName ?? t.staff?.name ?? null },
      })
    }
  }
  console.log(`[A] ${bare.length} declaration(s) given outlet/date/staff`)

  // ── B) reference keys ─────────────────────────────────────────────────────
  const refRows = await prisma.staffTransaction.findMany({
    where: { referenceKey: null, category: 'PAYMENT', reference: { not: null }, status: { not: 'REJECTED' } },
    include: { session: { select: { outletId: true } } },
    orderBy: { createdAt: 'asc' },
  })
  const claimed = new Map<string, string>(
    (await prisma.staffTransaction.findMany({ where: { referenceKey: { not: null } }, select: { id: true, referenceKey: true } }))
      .map((r) => [r.referenceKey as string, r.id]),
  )
  let keyed = 0
  const clashes: string[] = []
  for (const t of refRows) {
    const key = await referenceKeyFor(prisma, { outletId: t.outletId ?? t.session?.outletId ?? null, category: t.category, paymentMethod: t.paymentMethod, reference: t.reference })
    if (!key) continue
    const holder = claimed.get(key)
    if (holder && holder !== t.id) {
      clashes.push(`  ${key}: row ${t.id} (${t.staffName ?? t.staffId}, ${t.amount}) duplicates row ${holder}`)
      continue
    }
    claimed.set(key, t.id)
    keyed++
    if (!DRY_RUN) await prisma.staffTransaction.update({ where: { id: t.id }, data: { referenceKey: key } })
  }
  console.log(`[B] ${keyed} reference key(s) set, ${clashes.length} duplicate reference(s) left for review`)
  for (const c of clashes) console.log(c)

  // ── C) link validated Transaction-Session collections ────────────────────
  const candidates = await prisma.dailyCollection.findMany({
    where: { ledgerBacked: false, notes: { startsWith: 'Validated from Transaction Session' } },
    include: { channels: { select: { channelCode: true, amount: true } } },
  })
  let linked = 0
  const mismatches: string[] = []
  for (const c of candidates) {
    const sessionId = TX_SESSION_NOTE.exec(c.notes || '')?.[1]
    if (!sessionId || !c.staffName) continue
    const staff = await prisma.user.findFirst({ where: { name: c.staffName }, select: { id: true } })
    const rows = await prisma.staffTransaction.findMany({
      where: { sessionId, status: 'APPROVED', collectionId: null, OR: [{ staffId: staff?.id ?? '__none__' }, { staffName: c.staffName }] },
    })
    // Same figures the validate route stored: PAYMENT rows by method.
    let cash = 0
    const channels: Record<string, number> = {}
    for (const r of rows) {
      if (r.category !== 'PAYMENT') continue
      const m = (r.paymentMethod || 'CASH').toUpperCase()
      if (m === 'CASH') cash = roundMoney(cash + r.amount)
      else channels[m] = roundMoney((channels[m] || 0) + r.amount)
    }
    const stored = channelAmountsFor(c)
    const codes = new Set([...Object.keys(stored), ...Object.keys(channels)])
    const matches = roundMoney(cash) === roundMoney(c.cash) && [...codes].every((k) => roundMoney(stored[k] || 0) === roundMoney(channels[k] || 0))
    if (!rows.length || !matches) {
      mismatches.push(`  collection ${c.id} (${c.staffName}, ${c.date.toISOString().slice(0, 10)}): stored cash ${c.cash} ${JSON.stringify(stored)} vs declarations cash ${cash} ${JSON.stringify(channels)} (${rows.length} rows)`)
      continue
    }
    linked++
    if (!DRY_RUN) {
      await prisma.$transaction(async (tx) => {
        await linkAndLockTransactions(tx, { ids: rows.map((r) => r.id), collectionId: c.id, outletId: c.outletId, date: c.date, staffName: c.staffName! })
        await tx.dailyCollection.update({ where: { id: c.id }, data: { ledgerBacked: true } })
      })
    }
  }
  console.log(`[C] ${linked} of ${candidates.length} validated collection(s) linked to their transactions, ${mismatches.length} left unlinked (figures differ)`)
  for (const m of mismatches) console.log(m)
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
