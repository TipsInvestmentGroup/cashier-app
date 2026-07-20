// The General Ledger posting engine — the single choke point every module
// (Procurement/Inventory/Sales/Collections) goes through to record a
// financial event. Journals in this phase are system-generated only: there
// is no manual/draft journal UI, so the only way to correct a posted entry
// is reverseJournalEntry() posting an equal-and-opposite entry — same
// "never delete, only reverse" audit principle already used for
// StockLedgerEntry. See the Finance Platform schema section comment in
// prisma/schema.prisma for the full model shapes.
import { roundMoney } from '@/lib/utils'
import type { PrismaClient } from '@prisma/client'

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const
export type AccountType = (typeof ACCOUNT_TYPES)[number]

export const SOURCE_MODULES = ['PROCUREMENT', 'INVENTORY', 'SALES', 'COLLECTIONS', 'MANUAL'] as const
export type SourceModule = (typeof SOURCE_MODULES)[number]

// A plain Prisma client or an in-flight $transaction callback client — every
// function here accepts either (same Tx shape as lib/stock.ts), so callers
// can post inside their own existing transaction (e.g. receiveGrn) or
// standalone.
export type Db = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export interface JournalLineInput {
  accountId: string
  outletId?: string | null
  debit?: number
  credit?: number
  description?: string | null
}

export interface PostJournalEntryInput {
  companyId: string
  entryDate: Date
  sourceModule: SourceModule
  sourceType?: string | null
  sourceId?: string | null
  description?: string | null
  createdById: string
  lines: JournalLineInput[]
}

async function nextEntryNumber(db: Db, prefix: string): Promise<string> {
  const n = (await db.journalEntry.count()) + 1
  return `${prefix}-${String(n).padStart(6, '0')}`
}

/** Throws if the company has a FinancialPeriod covering entryDate and it is
 *  LOCKED. Absence of any period row means "unconfigured — treat as open",
 *  matching the rest of the app's "no config = today's behavior" convention. */
async function assertPeriodOpen(db: Db, companyId: string, entryDate: Date) {
  // findMany, not findFirst — Stage 4 periods can nest (e.g. a MONTHLY
  // period inside its ANNUAL year), so more than one row can cover the same
  // date. Locked wins if ANY covering period is locked, not just whichever
  // one happens to be returned first.
  const periods = await db.financialPeriod.findMany({
    where: { companyId, startDate: { lte: entryDate }, endDate: { gte: entryDate } },
  })
  const locked = periods.find((p) => p.status === 'LOCKED')
  if (locked) {
    throw new Error(`The financial period "${locked.name}" is locked. Ask an authorized user to reopen it before posting.`)
  }
}

/**
 * Validates and writes one balanced journal entry (header + lines). Every
 * line must have exactly one of debit/credit > 0, and the entry must
 * balance (sum debit === sum credit) after rounding to 2dp. Pass `tx` when
 * calling from inside an existing prisma.$transaction (e.g. receiveGrn) so
 * the posting is atomic with the business event that caused it.
 */
export async function postJournalEntry(db: Db, input: PostJournalEntryInput): Promise<{ id: string; entryNumber: string }> {
  if (!input.lines.length) throw new Error('A journal entry needs at least one line')

  let totalDebit = 0
  let totalCredit = 0
  for (const line of input.lines) {
    const debit = roundMoney(line.debit || 0)
    const credit = roundMoney(line.credit || 0)
    if (debit > 0 && credit > 0) throw new Error('A journal line cannot have both a debit and a credit')
    if (debit <= 0 && credit <= 0) throw new Error('Every journal line needs a debit or a credit amount')
    totalDebit = roundMoney(totalDebit + debit)
    totalCredit = roundMoney(totalCredit + credit)
  }
  if (totalDebit !== totalCredit) {
    throw new Error(`Journal entry does not balance: debits ${totalDebit} vs credits ${totalCredit}`)
  }

  await assertPeriodOpen(db, input.companyId, input.entryDate)

  const entryNumber = await nextEntryNumber(db, 'JE')
  const entry = await db.journalEntry.create({
    data: {
      entryNumber,
      companyId: input.companyId,
      entryDate: input.entryDate,
      sourceModule: input.sourceModule,
      sourceType: input.sourceType || null,
      sourceId: input.sourceId || null,
      description: input.description || null,
      createdById: input.createdById,
      lines: {
        create: input.lines.map((l) => ({
          accountId: l.accountId,
          outletId: l.outletId || null,
          debit: roundMoney(l.debit || 0),
          credit: roundMoney(l.credit || 0),
          description: l.description || null,
        })),
      },
    },
  })
  return { id: entry.id, entryNumber: entry.entryNumber }
}

/**
 * Posts an equal-and-opposite entry for a previously posted one and marks
 * the original REVERSED. The reversal itself is a normal POSTED entry (so
 * it, too, respects period locks) linked back via reversalOfId.
 */
export async function reverseJournalEntry(db: Db, opts: { journalEntryId: string; userId: string; reason?: string }): Promise<{ id: string; entryNumber: string }> {
  const original = await db.journalEntry.findUnique({ where: { id: opts.journalEntryId }, include: { lines: true } })
  if (!original) throw new Error('Journal entry not found')
  if (original.status === 'REVERSED') throw new Error('This journal entry has already been reversed')

  const reversal = await postJournalEntry(db, {
    companyId: original.companyId,
    entryDate: new Date(),
    sourceModule: original.sourceModule as SourceModule,
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    description: opts.reason ? `Reversal of ${original.entryNumber}: ${opts.reason}` : `Reversal of ${original.entryNumber}`,
    createdById: opts.userId,
    lines: original.lines.map((l) => ({
      accountId: l.accountId,
      outletId: l.outletId,
      debit: l.credit,
      credit: l.debit,
      description: l.description,
    })),
  })

  await db.journalEntry.update({
    where: { id: original.id },
    data: { status: 'REVERSED', reversedById: opts.userId, reversedAt: new Date() },
  })
  await db.journalEntry.update({
    where: { id: reversal.id },
    data: { reversalOfId: original.id },
  })

  return reversal
}
