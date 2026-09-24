import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { getFundingSourceBalance } from '@/lib/expense-ledger'
import { fundClassOf } from '@/lib/expense-funds'
import { previousClosing, computeCash, businessTodayUtc } from '@/lib/cash-recon'

const VIEWER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/**
 * GET — §6 reconciliation for one fund: does its ledger balance agree with the
 * §5 available-balance formula for its type? Returns both figures, a mismatch
 * flag (never a silent override — §6), and a per-fund-class breakdown so the
 * custodian can see WHERE the number comes from, not just that it reconciles.
 *
 * By fund class:
 *   CASHIER_CASH — the daily cash position (yesterday's close + today's
 *     collection + cash paid bills − cash disbursed). Ledger and computed
 *     figures are the same source by construction (getFundingSourceBalance reads
 *     computeAvailableCashToday), so a mismatch here would signal a real bug,
 *     not a data-entry gap. Also surfaces the latest recorded physical-count
 *     variance from CashRecon, which is the genuine cash reconciliation.
 *   PETTY_CASH — the append-only ledger (opening + Σreceived − Σpaid) vs the
 *     materialized currentBalance. These CAN drift (two writers), so this is the
 *     comparison that matters for this class.
 *   DIGITAL — the linked bank/GL balance vs the sum of expense payments booked
 *     against the fund; surfaces the wrapped account so it can be tied out to a
 *     statement.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!VIEWER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const source = await prisma.fundingSource.findUnique({
    where: { id },
    include: { companyPaymentAccount: { select: { id: true, accountName: true, bankName: true } } },
  })
  if (!source) return NextResponse.json({ error: 'Funding source not found' }, { status: 404 })

  const fundClass = fundClassOf(source.sourceType)
  const computedBalance = await getFundingSourceBalance(prisma, source)

  // status is honest about what was actually checked, rather than a boolean that
  // reports "reconciled" for a comparison that never happened:
  //   RECONCILED   — an independent figure was compared and agrees
  //   MISMATCH     — an independent figure was compared and disagrees (§6: flag,
  //                  never silently override)
  //   UNVERIFIABLE — there is no independent figure to compare against (the
  //                  balance IS the single source of truth, or its opening
  //                  predates ledger tracking), so a green tick would be a lie
  type ReconStatus = 'RECONCILED' | 'MISMATCH' | 'UNVERIFIABLE'
  let status: ReconStatus
  let statusNote: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let breakdown: Record<string, any> = {}
  let ledgerBalance = computedBalance

  if (fundClass === 'CASHIER_CASH') {
    const today = await businessTodayUtc(source.outletId)
    const [opening, cash] = await Promise.all([
      previousClosing(today, source.outletId),
      computeCash(today, source.outletId),
    ])
    const latestRecon = await prisma.cashRecon.findFirst({
      where: { outletId: source.outletId ?? undefined },
      orderBy: { date: 'desc' },
      select: { date: true, closingBalance: true, verifiedAmount: true, variance: true, verifiedBy: true },
    })
    breakdown = { opening, cashCollected: cash.cashCollected, paidBillsCash: cash.paidBillsCash, cashExpenses: cash.cashExpenses, latestRecon }
    ledgerBalance = computedBalance
    // There is no stored ledger for a cashier drawer — the balance IS the live
    // cash position, so there is nothing to drift against here. The genuine
    // reconciliation is the physical count (latestRecon), shown separately.
    status = 'UNVERIFIABLE'
    statusNote = 'The balance is the live cash position — there is no separate stored ledger to drift against. The real check is the physical count below.'
  } else if (fundClass === 'DIGITAL') {
    const payments = await prisma.expensePayment.aggregate({ where: { fundingSourceId: id }, _sum: { amount: true }, _count: true })
    const verified = await prisma.expensePayment.count({ where: { fundingSourceId: id, verificationId: { not: null } } })
    breakdown = {
      account: source.companyPaymentAccount,
      totalPaid: roundMoney(payments._sum.amount || 0),
      paymentCount: payments._count,
      verifiedCount: verified,
      unverifiedCount: payments._count - verified,
    }
    ledgerBalance = computedBalance
    // The balance is read live from the wrapped account's GL, so it ties to the
    // bank statement by construction — the meaningful gap here is unverified
    // payments (proof of payment), not a ledger drift.
    status = payments._count - verified > 0 ? 'MISMATCH' : 'RECONCILED'
    statusNote = payments._count - verified > 0
      ? `${payments._count - verified} digital payment(s) still lack proof of payment.`
      : 'Balance reads live from the linked account’s GL, and every payment has proof.'
  } else {
    // PETTY_CASH / OTHER — the one class with a genuine independent ledger to
    // check. Sum the append-only FundingSourceTxn rows directly (NOT via
    // listFundingSourceLedger, which back-derives opening from currentBalance and
    // so can only ever "agree" with it). A fund born in this framework has an
    // OPEN row, so Σtxns must equal currentBalance — any gap is real drift. A
    // fund seeded from a legacy PettyFund has currentBalance but no OPEN row and
    // no migrated history, so there is no independent anchor and we say so rather
    // than fake a green tick.
    const txns = await prisma.fundingSourceTxn.findMany({ where: { fundingSourceId: id }, orderBy: { createdAt: 'asc' } })
    const txnSum = roundMoney(txns.reduce((s, t) => s + t.amount, 0))
    const received = roundMoney(txns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0))
    const paid = roundMoney(txns.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0))
    const hasOpen = txns.some((t) => t.type === 'OPEN')

    if (hasOpen) {
      ledgerBalance = txnSum
      const drift = Math.abs(roundMoney(txnSum - computedBalance)) > 0.005
      status = drift ? 'MISMATCH' : 'RECONCILED'
      statusNote = drift
        ? 'The append-only ledger does not sum to the fund balance — a write updated one without the other.'
        : 'The append-only ledger sums exactly to the fund balance.'
      breakdown = { anchored: true, received, paid, closing: computedBalance }
    } else {
      // No OPEN row ⇒ opening predates ledger tracking; can't independently verify.
      ledgerBalance = computedBalance
      status = 'UNVERIFIABLE'
      statusNote = 'This fund’s opening balance predates ledger tracking (e.g. migrated from the legacy petty cash fund), so recorded movements can’t be independently reconciled to the total yet.'
      breakdown = { anchored: false, received, paid, closing: computedBalance, preLedgerOpening: roundMoney(computedBalance - txnSum) }
    }
  }

  const mismatchAmount = roundMoney(ledgerBalance - computedBalance)

  return NextResponse.json({
    fundingSourceId: id,
    name: source.name,
    sourceType: source.sourceType,
    fundClass,
    computedBalance,
    ledgerBalance,
    status,
    statusNote,
    mismatchAmount,
    breakdown,
  })
}
