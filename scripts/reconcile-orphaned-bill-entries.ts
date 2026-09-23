// #105 — Clean up GL entries left orphaned by bills/payments that were deleted
// BEFORE delete/edit learned to reverse the ledger (see app/api/signed-bills/[id]).
//
// A JournalEntry with sourceType SignedBill / PaidBill / SignedBillWriteOff
// whose sourceId no longer resolves is a posting for a record that was hard-
// deleted without a reversal — so Accounts Receivable (and Cash/Sales) stay
// overstated forever. This reverses each such entry (equal-and-opposite, never
// delete — the "never delete, only reverse" rule), then rebuilds every credit
// account balance from surviving source so the subledger matches.
//
// Safe + idempotent: only touches non-reversed entries whose source is gone; a
// second run finds none.
//
// Bootstraps its own Prisma client (adapter-by-DATABASE_URL, like prisma/seed.ts).
//
// Usage:
//   npx tsx scripts/reconcile-orphaned-bill-entries.ts            # apply
//   npx tsx scripts/reconcile-orphaned-bill-entries.ts --dry-run  # report only
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { reverseJournalEntry } from '../lib/ledger'
import { reconcileAllCreditLedgers } from '../lib/credit-ledger'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')
const SOURCE_TYPES = ['SignedBill', 'PaidBill', 'SignedBillWriteOff'] as const

async function sourceExists(sourceType: string, sourceId: string): Promise<boolean> {
  if (sourceType === 'SignedBill') return !!(await prisma.signedBill.findUnique({ where: { id: sourceId }, select: { id: true } }))
  if (sourceType === 'PaidBill') return !!(await prisma.paidBill.findUnique({ where: { id: sourceId }, select: { id: true } }))
  if (sourceType === 'SignedBillWriteOff') return !!(await prisma.signedBillWriteOff.findUnique({ where: { id: sourceId }, select: { id: true } }))
  return true
}

async function main() {
  const candidates = await prisma.journalEntry.findMany({
    where: { status: { not: 'REVERSED' }, sourceType: { in: SOURCE_TYPES as unknown as string[] } },
    select: { id: true, entryNumber: true, sourceType: true, sourceId: true, description: true },
  })

  let reversed = 0
  for (const je of candidates) {
    if (!je.sourceId) continue
    if (await sourceExists(je.sourceType!, je.sourceId)) continue

    console.log(`[orphan] ${je.entryNumber} (${je.sourceType} ${je.sourceId} — source missing): ${je.description ?? ''}`)
    if (!DRY_RUN) {
      await reverseJournalEntry(prisma as never, {
        journalEntryId: je.id, userId: 'system',
        reason: `Orphaned ${je.sourceType} entry — source row no longer exists (#105 cleanup)`,
      })
    }
    reversed++
  }

  if (!DRY_RUN && reversed > 0) {
    const recon = await reconcileAllCreditLedgers(prisma as never)
    console.log(`[orphan] rebuilt credit ledgers: ${recon.accounts} accounts, ${recon.nonZero} non-zero, total outstanding ${recon.totalOutstanding}`)
  }

  console.log(`\n[orphan] ${DRY_RUN ? 'would reverse' : 'reversed'} ${reversed} orphaned entry(ies).`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
