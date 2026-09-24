// Banking & Cash Management — Stage 3 of the Finance Platform.
// CompanyPaymentAccount is the real bank/mobile-money/cash account instance
// under a PaymentChannel "type" (Stage 1); this file resolves which account
// a channel defaults to, and posts the five cash-management movement types
// (transfer/deposit/withdrawal/bank charge/interest) through the same GL
// engine every other module uses.
import { prisma } from './prisma'
import { roundMoney } from './utils'
import { postJournalEntry, type Db } from './ledger'
import { resolveAccountId } from './finance-mapping'

export const BANK_TRANSACTION_TYPES = ['TRANSFER', 'DEPOSIT', 'WITHDRAWAL', 'BANK_CHARGE', 'INTEREST'] as const
export type BankTransactionType = (typeof BANK_TRANSACTION_TYPES)[number]

/**
 * The single definition of "what counts as a cash account" for a company —
 * every CompanyPaymentAccount's GL account, plus the three seeded default
 * Cash/Bank/Mobile-Money accounts. Shared by lib/finance-statements.ts (Cash
 * Flow Statement) and lib/finance-dashboard.ts (Cash Position) — previously
 * each had its own byte-identical copy of this query, which could silently
 * diverge if one was ever edited without the other.
 */
export async function cashAccountIds(companyId: string): Promise<string[]> {
  const [companyAccounts, seeded] = await Promise.all([
    prisma.companyPaymentAccount.findMany({ where: { companyId }, select: { glAccountId: true } }),
    prisma.account.findMany({ where: { companyId, code: { in: ['1000', '1010', '1020'] } }, select: { id: true } }),
  ])
  return [...new Set([...companyAccounts.map((a) => a.glAccountId), ...seeded.map((a) => a.id)])]
}

/**
 * The account a channel resolves to when nothing more specific is given:
 * an outlet-scoped default (if outletId given and one exists) beats the
 * company-wide default. Returns null if no CompanyPaymentAccount is set up
 * yet for this channel — callers fall back further (PaymentChannel.glAccountId,
 * then the system default), matching the "unconfigured = today's behavior"
 * convention used throughout this app.
 */
export async function resolveDefaultCompanyAccountId(db: Db, opts: { companyId: string; paymentChannelId: string; outletId?: string | null }): Promise<string | null> {
  if (opts.outletId) {
    const outletDefault = await db.companyPaymentAccount.findFirst({
      where: { companyId: opts.companyId, paymentChannelId: opts.paymentChannelId, outletId: opts.outletId, isDefault: true, isActive: true },
    })
    if (outletDefault) return outletDefault.glAccountId
  }
  const companyDefault = await db.companyPaymentAccount.findFirst({
    where: { companyId: opts.companyId, paymentChannelId: opts.paymentChannelId, outletId: null, isDefault: true, isActive: true },
  })
  return companyDefault?.glAccountId || null
}

/** Sets isDefault on one account, clearing it from every other account in
 *  the same (companyId, paymentChannelId, outletId) scope — only one
 *  default per scope, enforced here rather than at the schema level since
 *  SQLite can't express a partial-unique-index on a boolean flag. */
export async function setDefaultCompanyPaymentAccount(accountId: string): Promise<void> {
  const account = await prisma.companyPaymentAccount.findUniqueOrThrow({ where: { id: accountId } })
  await prisma.$transaction([
    prisma.companyPaymentAccount.updateMany({
      where: { companyId: account.companyId, paymentChannelId: account.paymentChannelId, outletId: account.outletId },
      data: { isDefault: false },
    }),
    prisma.companyPaymentAccount.update({ where: { id: accountId }, data: { isDefault: true } }),
  ])
}

/** An account's running balance is just its GL account's ledger balance —
 *  no separate balance column to keep in sync. */
export async function companyAccountBalance(db: Db, companyPaymentAccountId: string): Promise<number> {
  const account = await db.companyPaymentAccount.findUniqueOrThrow({ where: { id: companyPaymentAccountId } })
  const lines = await db.journalLine.findMany({ where: { accountId: account.glAccountId }, select: { debit: true, credit: true } })
  return roundMoney(lines.reduce((s: number, l: { debit: number; credit: number }) => s + l.debit - l.credit, 0))
}

export interface BankTransactionInput {
  companyId: string
  type: BankTransactionType
  fromAccountId?: string | null
  toAccountId?: string | null
  // A leg that is NOT a CompanyPaymentAccount — a raw GL account id used for the
  // counter-leg when there is no account instance to name. The Petty Cash top-up
  // (execute-topup) transfers money OUT of a digital CompanyPaymentAccount and
  // INTO the company's Cash-on-Hand GL (a petty cash CASH fund has no CPA
  // wrapper), so it passes fromAccountId = the digital account and
  // toGlAccountId = the resolved cash GL. Ignored when the matching CPA id is
  // also given (the CPA wins, so existing callers are unaffected).
  fromGlAccountId?: string | null
  toGlAccountId?: string | null
  amount: number
  transactionDate: Date
  reference?: string | null
  note?: string | null
  createdById: string
  // Loose ref stamped onto the BankTransaction — see the model doc. Only the
  // top-up paying leg sets it; every existing caller leaves it undefined.
  expenseRequestId?: string | null
}

/** One side of a movement, resolved from either a CompanyPaymentAccount (the
 *  common case) or a raw GL account id (the top-up cash leg). `cpaId` is null
 *  for a raw-GL leg, so the BankTransaction records only the CPA side(s). */
interface MovementLeg {
  glAccountId: string
  label: string
  cpaId: string | null
}

async function resolveLeg(db: Db, cpaId: string | null | undefined, rawGlId: string | null | undefined): Promise<MovementLeg | null> {
  if (cpaId) {
    const cpa = await db.companyPaymentAccount.findUniqueOrThrow({ where: { id: cpaId } })
    return { glAccountId: cpa.glAccountId, label: cpa.accountName, cpaId: cpa.id }
  }
  if (rawGlId) {
    const acct = await db.account.findUniqueOrThrow({ where: { id: rawGlId } })
    return { glAccountId: acct.id, label: acct.name, cpaId: null }
  }
  return null
}

/**
 * Posts one of the five cash-management movement types and records a
 * BankTransaction. See the BankTransaction model comment in
 * prisma/schema.prisma for the Dr/Cr rule per type.
 *
 * Owns its own transaction. Callers that must post a bank movement AND other
 * ledger writes atomically (the Petty Cash top-up posts this TRANSFER and the
 * receiving fund's REPLENISH in one go) call the tx-aware core
 * postBankTransactionTx directly on their own `db` instead — this wrapper is the
 * standalone entry point, mirroring replenishFundingSource/creditFundingSource.
 */
export async function postBankTransaction(input: BankTransactionInput): Promise<{ id: string }> {
  return prisma.$transaction((tx) => postBankTransactionTx(tx, input))
}

/**
 * The tx-aware core of postBankTransaction — runs on the passed `db` so it
 * composes inside a caller's transaction (no nested prisma.$transaction). Each
 * of the two-account movement types (TRANSFER/DEPOSIT/WITHDRAWAL) resolves each
 * leg from either a CompanyPaymentAccount or a raw GL account id (see
 * BankTransactionInput.fromGlAccountId/toGlAccountId).
 */
export async function postBankTransactionTx(db: Db, input: BankTransactionInput): Promise<{ id: string }> {
  const amount = roundMoney(input.amount)
  if (amount <= 0) throw new Error('Amount must be positive')
  if (!BANK_TRANSACTION_TYPES.includes(input.type)) throw new Error('Invalid transaction type')

  const [fromLeg, toLeg] = await Promise.all([
    resolveLeg(db, input.fromAccountId, input.fromGlAccountId),
    resolveLeg(db, input.toAccountId, input.toGlAccountId),
  ])

  let lines: { accountId: string; debit?: number; credit?: number; description: string }[]
  switch (input.type) {
    case 'TRANSFER':
      if (!fromLeg || !toLeg) throw new Error('A transfer needs both a from-account and a to-account')
      lines = [
        { accountId: toLeg.glAccountId, debit: amount, description: `Transfer from ${fromLeg.label}` },
        { accountId: fromLeg.glAccountId, credit: amount, description: `Transfer to ${toLeg.label}` },
      ]
      break
    case 'DEPOSIT':
      if (!fromLeg || !toLeg) throw new Error('A deposit needs both a from-account (e.g. Cash) and a to-account (bank)')
      lines = [
        { accountId: toLeg.glAccountId, debit: amount, description: `Deposit from ${fromLeg.label}` },
        { accountId: fromLeg.glAccountId, credit: amount, description: `Deposit to ${toLeg.label}` },
      ]
      break
    case 'WITHDRAWAL':
      if (!fromLeg || !toLeg) throw new Error('A withdrawal needs both a from-account (bank) and a to-account (e.g. Cash)')
      lines = [
        { accountId: toLeg.glAccountId, debit: amount, description: `Withdrawal from ${fromLeg.label}` },
        { accountId: fromLeg.glAccountId, credit: amount, description: `Withdrawal to ${toLeg.label}` },
      ]
      break
    case 'BANK_CHARGE': {
      if (!fromLeg) throw new Error('A bank charge needs the account it was deducted from')
      const chargesAccountId = await resolveAccountId(db, { companyId: input.companyId, key: 'BANK_CHARGES_EXPENSE' })
      lines = [
        { accountId: chargesAccountId, debit: amount, description: `Bank charge on ${fromLeg.label}` },
        { accountId: fromLeg.glAccountId, credit: amount, description: 'Bank charge' },
      ]
      break
    }
    case 'INTEREST': {
      if (!toLeg) throw new Error('Interest needs the account it was credited to')
      const interestAccountId = await resolveAccountId(db, { companyId: input.companyId, key: 'INTEREST_INCOME' })
      lines = [
        { accountId: toLeg.glAccountId, debit: amount, description: `Interest credited to ${toLeg.label}` },
        { accountId: interestAccountId, credit: amount, description: 'Interest income' },
      ]
      break
    }
  }

  const { id: journalEntryId } = await postJournalEntry(db, {
    companyId: input.companyId, entryDate: input.transactionDate, sourceModule: 'MANUAL', sourceType: 'BankTransaction', sourceId: null,
    description: input.note || `${input.type} — ${input.reference || ''}`.trim(), createdById: input.createdById, lines,
  })

  const txn = await db.bankTransaction.create({
    data: {
      companyId: input.companyId, type: input.type,
      // Only real CompanyPaymentAccount legs are recorded here; a raw-GL leg
      // leaves its side null (the GL entry still carries it).
      fromAccountId: fromLeg?.cpaId ?? null, toAccountId: toLeg?.cpaId ?? null,
      amount, transactionDate: input.transactionDate, reference: input.reference || null, note: input.note || null,
      createdById: input.createdById, journalEntryId, expenseRequestId: input.expenseRequestId || null,
    },
  })
  await db.journalEntry.update({ where: { id: journalEntryId }, data: { sourceId: txn.id } })

  return { id: txn.id }
}
