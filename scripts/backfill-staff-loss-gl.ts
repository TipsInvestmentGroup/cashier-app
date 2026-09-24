// #111 residual — Put existing STAFF_LOSS receivables on the GL.
//
// STAFF_LOSS signed bills recorded before this landed never posted to the
// ledger (postCreditSale skips them), so the shortfall staff owe was invisible
// in the GL while payroll was already crediting A/R when it recovered them.
// syncStaffLossReceivable posts Dr Accounts Receivable / Cr Sales Revenue for
// each bill's gross amount (idempotent — a bill already posted is skipped).
//
// Usage:
//   npx tsx scripts/backfill-staff-loss-gl.ts            # apply
//   npx tsx scripts/backfill-staff-loss-gl.ts --dry-run  # report only
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { syncStaffLossReceivable } from '../lib/staff-loss-gl'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const bills = await prisma.signedBill.findMany({
    where: { billType: 'STAFF_LOSS', status: { not: 'WRITTEN_OFF' } },
    select: { id: true, amount: true, journalEntryId: true },
    orderBy: { date: 'asc' },
  })
  console.log(`[backfill] ${bills.length} STAFF_LOSS bill(s)`)

  let posted = 0, skipped = 0
  for (const b of bills) {
    if (b.journalEntryId) { skipped++; continue } // already on the GL
    if (DRY_RUN) { posted++; continue }
    await syncStaffLossReceivable(prisma as never, b.id)
    const after = await prisma.signedBill.findUnique({ where: { id: b.id }, select: { journalEntryId: true } })
    if (after?.journalEntryId) posted++
  }
  console.log(`[backfill] ${DRY_RUN ? 'would post' : 'posted'} ${posted}; ${skipped} already on GL.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
