// #106 — Post receipts that were recorded before postReceipt learned to book
// cash that can't yet draw down a recognized receivable.
//
// A PaidBill with journalEntryId == null is a receipt whose cash never reached
// the GL. Re-running postReceipt on each now books it correctly:
//   • linked to a posted (recognized) bill  -> Dr Cash / Cr Accounts Receivable
//   • linked to a still-pending credit bill  -> Dr Cash / Cr Customer Deposits
//     (applied to A/R automatically when the bill is later approved)
//   • an unlinked advance / overpayment      -> Dr Cash / Cr Customer Deposits
//   • a STAFF_LOSS bill receipt              -> left unposted (not a GL receivable)
//
// Safe + idempotent: postReceipt no-ops once a receipt already has a journal
// entry, so a second run touches nothing.
//
// Bootstraps its own Prisma client (adapter-by-DATABASE_URL, like prisma/seed.ts).
//
// Usage:
//   npx tsx scripts/backfill-unposted-receipts.ts            # apply
//   npx tsx scripts/backfill-unposted-receipts.ts --dry-run  # report only
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { postReceipt } from '../lib/finance-ar'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const receipts = await prisma.paidBill.findMany({
    where: { journalEntryId: null },
    select: { id: true, signedBillId: true, amountPaid: true, paymentMethod: true, outletId: true, journalEntryId: true, date: true },
    orderBy: { date: 'asc' },
  })
  console.log(`[backfill] ${receipts.length} receipt(s) with no journal entry`)

  let posted = 0
  for (const r of receipts) {
    if (DRY_RUN) { posted++; continue }
    await postReceipt(prisma as never, r, 'system')
    const after = await prisma.paidBill.findUnique({ where: { id: r.id }, select: { journalEntryId: true } })
    if (after?.journalEntryId) posted++
  }

  console.log(`[backfill] ${DRY_RUN ? 'would post' : 'posted'} ${DRY_RUN ? receipts.length : posted} receipt(s) to the GL${DRY_RUN ? '' : ` (${receipts.length - posted} left unposted — STAFF_LOSS / no company)`}.`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
