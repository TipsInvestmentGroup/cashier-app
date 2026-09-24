// #112 — Move historical expense spend OUT of the 9000 suspense account into
// each item's now-mapped operating-cost account. Expenses posted while their
// category had no budgetAccountId landed in "Unclassified / Suspense"; now that
// the categories are mapped (scripts/backfill-expense-category-accounts.ts),
// this reclassifies the existing balance.
//
// Never edits or deletes the original entry (audit-safe "only reverse/adjust"
// principle): for each non-reversed journal entry with a suspense debit, it
// posts ONE balancing reclass entry — Dr <mapped account(s)> / Cr 9000 suspense
// — for the same amounts, reconstructing the per-category split from the
// source:
//   • ExpensePayment -> its PaymentAllocations -> each ExpenseRequest.category
//   • PettyCash       -> its functionName (bridges to a category)
// A portion whose category is still unmapped (resolves back to suspense) is
// left in place. Posts on the ORIGINAL entry date to keep each period's P&L
// correct — a locked period is reported and skipped, not forced.
//
// Idempotent: skips an entry that already has a non-reversed SuspenseReclass.
//
// Usage:
//   npx tsx scripts/reclass-suspense-expenses.ts            # apply
//   npx tsx scripts/reclass-suspense-expenses.ts --dry-run  # report only
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import 'dotenv/config'
import { postJournalEntry } from '../lib/ledger'
import { resolveAccountId, resolveExpenseDebitAccount } from '../lib/finance-mapping'
import { roundMoney } from '../lib/utils'

const url = process.env.DATABASE_URL || 'file:./dev.db'
const adapter = /^postgres(ql)?:\/\//.test(url)
  ? new PrismaPg({ connectionString: url })
  : new PrismaBetterSqlite3({ url })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any)

const DRY_RUN = process.argv.includes('--dry-run')

async function targetSplit(companyId: string, je: { sourceType: string | null; sourceId: string | null }): Promise<Map<string, number>> {
  const byAccount = new Map<string, number>()
  const add = async (categoryId: string | null, functionName: string | null, amount: number) => {
    if (amount <= 0) return
    const acct = await resolveExpenseDebitAccount(prisma as never, { companyId, categoryId, functionName })
    byAccount.set(acct, roundMoney((byAccount.get(acct) || 0) + amount))
  }
  if (je.sourceType === 'ExpensePayment' && je.sourceId) {
    const allocs = await prisma.paymentAllocation.findMany({
      where: { expensePaymentId: je.sourceId },
      select: { amount: true, expenseRequest: { select: { categoryId: true } } },
    })
    for (const a of allocs) await add(a.expenseRequest?.categoryId ?? null, null, a.amount)
  }
  return byAccount
}

async function main() {
  const companies = await prisma.company.findMany({ select: { id: true } })
  let entries = 0, moved = 0, movedAmount = 0, skippedLocked = 0, alreadyDone = 0, noTarget = 0

  for (const company of companies) {
    const suspenseId = await resolveAccountId(prisma as never, { companyId: company.id, key: 'PETTY_CASH_EXPENSE' })

    const lines = await prisma.journalLine.findMany({
      where: { accountId: suspenseId, debit: { gt: 0 }, journalEntry: { companyId: company.id, status: { not: 'REVERSED' } } },
      select: { debit: true, outletId: true, journalEntry: { select: { id: true, entryNumber: true, entryDate: true, sourceType: true, sourceId: true } } },
    })

    for (const l of lines) {
      const je = l.journalEntry
      entries++
      const existing = await prisma.journalEntry.findFirst({
        where: { sourceType: 'SuspenseReclass', sourceId: je.id, status: { not: 'REVERSED' } }, select: { id: true },
      })
      if (existing) { alreadyDone++; continue }

      // Build the per-account split. For petty cash the whole suspense debit is
      // one category; for an expense payment it comes from the allocations.
      let split: Map<string, number>
      if (je.sourceType === 'PettyCash' && je.sourceId) {
        const pc = await prisma.pettyCash.findUnique({ where: { id: je.sourceId }, select: { functionName: true } })
        const acct = await resolveExpenseDebitAccount(prisma as never, { companyId: company.id, functionName: pc?.functionName ?? null })
        split = new Map([[acct, roundMoney(l.debit)]])
      } else {
        split = await targetSplit(company.id, je)
      }

      // Drop anything that still resolves to suspense, and cap at the suspense debit.
      split.delete(suspenseId)
      let toMove = roundMoney([...split.values()].reduce((s, v) => s + v, 0))
      if (toMove <= 0) { noTarget++; continue }
      if (toMove > roundMoney(l.debit)) {
        // Scale down proportionally so we never move more than what sits in suspense for this entry.
        const factor = roundMoney(l.debit) / toMove
        for (const [k, v] of split) split.set(k, roundMoney(v * factor))
        toMove = roundMoney(l.debit)
      }

      const drLines = [...split.entries()].map(([accountId, amt]) => ({ accountId, debit: amt, outletId: l.outletId, description: 'Reclass from suspense' }))
      console.log(`  ${DRY_RUN ? 'would reclass' : 'RECLASS'} ${je.entryNumber}: ${toMove} out of suspense across ${drLines.length} account(s)`)
      if (!DRY_RUN) {
        try {
          await postJournalEntry(prisma as never, {
            companyId: company.id, entryDate: je.entryDate, sourceModule: 'EXPENSE',
            sourceType: 'SuspenseReclass', sourceId: je.id, description: `Reclassify ${je.entryNumber} out of suspense`,
            createdById: 'system',
            lines: [...drLines, { accountId: suspenseId, credit: toMove, outletId: l.outletId, description: 'Clear suspense' }],
          })
        } catch (e) {
          if (e instanceof Error && /locked/i.test(e.message)) { skippedLocked++; console.log(`    SKIP (locked period) ${je.entryNumber}`); continue }
          throw e
        }
      }
      moved++; movedAmount = roundMoney(movedAmount + toMove)
    }
  }
  console.log(`[reclass] ${entries} suspense entr(y/ies); ${DRY_RUN ? 'would move' : 'moved'} ${moved} (${movedAmount}); ${alreadyDone} already done; ${noTarget} still-unmapped; ${skippedLocked} locked.`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(async () => { await prisma.$disconnect() })
