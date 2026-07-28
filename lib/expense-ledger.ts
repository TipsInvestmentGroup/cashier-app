// The Petty Cash Ledger — graduates FundingSource.currentBalance from a
// materialized-only figure to a full transaction history (FundingSourceTxn),
// and resolves a FundingSource's live balance per its sourceType, including
// the new CASHIER_DRAWER type (Petty Cash Custodian scenario A: a cashier's
// available daily cash automatically IS the petty cash balance, no manual
// opening balance). See docs/expense-disbursement-framework-design.md Stage 16
// decision 2, which this extends rather than replaces.
import type { Db } from '@/lib/ledger'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { companyAccountBalance } from '@/lib/finance-banking'
import { computeAvailableCashToday } from '@/lib/cash-recon'

export interface FundingSourceLike {
  id: string
  sourceType: string
  currentBalance: number
  companyPaymentAccountId: string | null
  outletId: string | null
}

/** Resolves a FundingSource's current balance the way it's actually backed:
 *  CASH/OTHER materialize their own currentBalance; BANK/MOBILE_MONEY/CARD
 *  compute live from the wrapped CompanyPaymentAccount's GL balance;
 *  CASHIER_DRAWER computes live from that outlet's cash-recon position
 *  (lib/cash-recon.ts) — same "GL/operational figure is the single source of
 *  truth" principle Stage 16 decision 2 already established for bank sources. */
export async function getFundingSourceBalance(db: Db, source: FundingSourceLike): Promise<number> {
  if (source.sourceType === 'BANK' || source.sourceType === 'MOBILE_MONEY' || source.sourceType === 'CARD') {
    if (!source.companyPaymentAccountId) return 0
    return companyAccountBalance(db, source.companyPaymentAccountId)
  }
  if (source.sourceType === 'CASHIER_DRAWER') {
    return computeAvailableCashToday(source.outletId)
  }
  return source.currentBalance
}

export interface ReplenishFundingSourceInput {
  fundingSourceId: string
  amount: number
  reference?: string | null
  note?: string | null
  createdById: string
  createdByName?: string | null
}

/** Allocates funds to a custodian (Petty Cash Ledger scenario B's "Funds
 *  Received"). CASH/OTHER only — CASHIER_DRAWER's balance always follows the
 *  cashier's daily cash automatically, and BANK/MOBILE_MONEY/CARD balances
 *  follow their GL account, so "replenishing" either would be meaningless. */
export async function replenishFundingSource(input: ReplenishFundingSourceInput) {
  const amount = roundMoney(input.amount)
  if (amount <= 0) throw new Error('Amount must be greater than zero')

  return prisma.$transaction(async (tx) => {
    const source = await tx.fundingSource.findUnique({ where: { id: input.fundingSourceId } })
    if (!source || !source.isActive) throw new Error('Funding source not found or inactive')
    if (source.sourceType !== 'CASH' && source.sourceType !== 'OTHER') {
      throw new Error(`${source.sourceType} funding sources are not replenished this way — their balance is always computed live`)
    }

    await tx.fundingSourceTxn.create({
      data: {
        fundingSourceId: source.id, type: 'REPLENISH', amount,
        reference: input.reference || null, note: input.note || null,
        createdById: input.createdById, createdByName: input.createdByName || null,
      },
    })
    const updated = await tx.fundingSource.update({
      where: { id: source.id },
      data: { currentBalance: roundMoney(source.currentBalance + amount) },
    })
    return updated
  })
}

export interface LedgerRow {
  id: string
  type: string
  amount: number
  reference: string | null
  note: string | null
  createdById: string | null
  createdByName: string | null
  createdAt: Date
  runningBalance: number
}

export interface FundingSourceLedger {
  fundingSourceId: string
  openingBalance: number
  totalReceived: number
  totalPaid: number
  closingBalance: number
  rows: LedgerRow[]
}

/** Full ledger for one CASH/OTHER funding source: opening balance, every
 *  FundingSourceTxn in date order with a running balance, and the
 *  Opening/Received/Paid/Closing summary the Petty Cash Ledger screen shows
 *  (Petty Cash Custodian scenario B's exact requested figures). Not meaningful
 *  for CASHIER_DRAWER/BANK/MOBILE_MONEY/CARD sources, whose balance is always
 *  read live rather than accumulated from a ledger — callers should use
 *  getFundingSourceBalance for those instead. */
export async function listFundingSourceLedger(fundingSourceId: string): Promise<FundingSourceLedger> {
  const source = await prisma.fundingSource.findUniqueOrThrow({ where: { id: fundingSourceId } })
  const txns = await prisma.fundingSourceTxn.findMany({ where: { fundingSourceId }, orderBy: { createdAt: 'asc' } })

  // The effective starting point for the running balance is derived from
  // currentBalance backward, not the stored openingBalance field — a funding
  // source that had payments before this ledger existed (e.g. seeded from a
  // legacy PettyFund) has "missing" history that would otherwise make the
  // running balance drift from the real currentBalance. Deriving it this way
  // keeps every row's running balance reconciling to currentBalance exactly,
  // with the gap (if any) implicitly absorbed into the displayed opening
  // figure rather than silently misstating the closing balance.
  const txnTotal = roundMoney(txns.reduce((s, t) => s + t.amount, 0))
  const effectiveOpening = roundMoney(source.currentBalance - txnTotal)

  let running = effectiveOpening
  const rows: LedgerRow[] = txns.map((t) => {
    running = roundMoney(running + t.amount)
    return { id: t.id, type: t.type, amount: t.amount, reference: t.reference, note: t.note, createdById: t.createdById, createdByName: t.createdByName, createdAt: t.createdAt, runningBalance: running }
  })

  const totalReceived = roundMoney(txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0))
  const totalPaid = roundMoney(txns.filter((t) => t.amount < 0).reduce((s, t) => s + -t.amount, 0))

  return {
    fundingSourceId,
    openingBalance: effectiveOpening,
    totalReceived,
    totalPaid,
    closingBalance: source.currentBalance,
    rows: rows.reverse(), // most recent first, for the screen
  }
}
