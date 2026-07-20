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
  amount: number
  transactionDate: Date
  reference?: string | null
  note?: string | null
  createdById: string
}

/**
 * Posts one of the five cash-management movement types and records a
 * BankTransaction. See the BankTransaction model comment in
 * prisma/schema.prisma for the Dr/Cr rule per type.
 */
export async function postBankTransaction(input: BankTransactionInput): Promise<{ id: string }> {
  const amount = roundMoney(input.amount)
  if (amount <= 0) throw new Error('Amount must be positive')
  if (!BANK_TRANSACTION_TYPES.includes(input.type)) throw new Error('Invalid transaction type')

  return prisma.$transaction(async (tx) => {
    const [fromAccount, toAccount] = await Promise.all([
      input.fromAccountId ? tx.companyPaymentAccount.findUniqueOrThrow({ where: { id: input.fromAccountId } }) : null,
      input.toAccountId ? tx.companyPaymentAccount.findUniqueOrThrow({ where: { id: input.toAccountId } }) : null,
    ])

    let lines: { accountId: string; debit?: number; credit?: number; description: string }[]
    switch (input.type) {
      case 'TRANSFER':
        if (!fromAccount || !toAccount) throw new Error('A transfer needs both a from-account and a to-account')
        lines = [
          { accountId: toAccount.glAccountId, debit: amount, description: `Transfer from ${fromAccount.accountName}` },
          { accountId: fromAccount.glAccountId, credit: amount, description: `Transfer to ${toAccount.accountName}` },
        ]
        break
      case 'DEPOSIT':
        if (!fromAccount || !toAccount) throw new Error('A deposit needs both a from-account (e.g. Cash) and a to-account (bank)')
        lines = [
          { accountId: toAccount.glAccountId, debit: amount, description: `Deposit from ${fromAccount.accountName}` },
          { accountId: fromAccount.glAccountId, credit: amount, description: `Deposit to ${toAccount.accountName}` },
        ]
        break
      case 'WITHDRAWAL':
        if (!fromAccount || !toAccount) throw new Error('A withdrawal needs both a from-account (bank) and a to-account (e.g. Cash)')
        lines = [
          { accountId: toAccount.glAccountId, debit: amount, description: `Withdrawal from ${fromAccount.accountName}` },
          { accountId: fromAccount.glAccountId, credit: amount, description: `Withdrawal to ${toAccount.accountName}` },
        ]
        break
      case 'BANK_CHARGE': {
        if (!fromAccount) throw new Error('A bank charge needs the account it was deducted from')
        const chargesAccountId = await resolveAccountId(tx, { companyId: input.companyId, key: 'BANK_CHARGES_EXPENSE' })
        lines = [
          { accountId: chargesAccountId, debit: amount, description: `Bank charge on ${fromAccount.accountName}` },
          { accountId: fromAccount.glAccountId, credit: amount, description: 'Bank charge' },
        ]
        break
      }
      case 'INTEREST': {
        if (!toAccount) throw new Error('Interest needs the account it was credited to')
        const interestAccountId = await resolveAccountId(tx, { companyId: input.companyId, key: 'INTEREST_INCOME' })
        lines = [
          { accountId: toAccount.glAccountId, debit: amount, description: `Interest credited to ${toAccount.accountName}` },
          { accountId: interestAccountId, credit: amount, description: 'Interest income' },
        ]
        break
      }
    }

    const { id: journalEntryId } = await postJournalEntry(tx, {
      companyId: input.companyId, entryDate: input.transactionDate, sourceModule: 'MANUAL', sourceType: 'BankTransaction', sourceId: null,
      description: input.note || `${input.type} — ${input.reference || ''}`.trim(), createdById: input.createdById, lines,
    })

    const txn = await tx.bankTransaction.create({
      data: {
        companyId: input.companyId, type: input.type, fromAccountId: input.fromAccountId || null, toAccountId: input.toAccountId || null,
        amount, transactionDate: input.transactionDate, reference: input.reference || null, note: input.note || null,
        createdById: input.createdById, journalEntryId,
      },
    })
    await tx.journalEntry.update({ where: { id: journalEntryId }, data: { sourceId: txn.id } })

    return { id: txn.id }
  })
}
