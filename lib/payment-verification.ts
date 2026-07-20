// Real-time Payment Verification — sourced from an internal system event
// (Cash/Bank/MobileMoney/POS, source=SYSTEM_GENERATED), a file import
// (source=IMPORT), a live API/webhook connector (source=API), or manual
// entry (source=MANUAL, the fallback). Independent of which reconciliation
// stage is open — a payment can be verified in real time ahead of Cashier
// Recon; PAYMENT_VERIFICATION is a pluggable check (lib/reconciliation-checks.ts)
// a company can require before CASHIER_RECON/FINANCE_RECON closes.
import { prisma } from '@/lib/prisma'

export type PaymentSource = 'API' | 'IMPORT' | 'MANUAL' | 'SYSTEM_GENERATED'

// Ingestion priority for a conflicting match on (channel, reference, amount):
// SYSTEM_GENERATED (this app's own record of the event) and API integrations
// are trusted over a later file import or manual entry.
const SOURCE_PRIORITY: Record<PaymentSource, number> = { SYSTEM_GENERATED: 4, API: 3, IMPORT: 2, MANUAL: 1 }
export function comparePaymentSourcePriority(a: PaymentSource, b: PaymentSource): number {
  return SOURCE_PRIORITY[a] - SOURCE_PRIORITY[b]
}

export interface CreatePaymentVerificationInput {
  companyId: string
  outletId?: string | null
  date: Date
  reference?: string | null
  channel: string
  amount: number
  customerName?: string | null
  paidAt?: Date | null
  source: PaymentSource
  sourceRef?: string | null
}

/**
 * Creates a PaymentVerification row, applying the ingestion-priority rule:
 * a new arrival matching an already-VERIFIED row on (channel, reference,
 * amount) is written as DUPLICATE (duplicateOfId set) rather than silently
 * overwriting the earlier, already-confirmed record.
 */
export async function createPaymentVerification(input: CreatePaymentVerificationInput) {
  // SYSTEM_GENERATED rows are keyed by sourceRef (e.g. "CashRecon:<id>") —
  // re-syncing the same source record (a re-save/correction) updates the
  // existing row in place instead of inserting another VERIFIED duplicate.
  if (input.sourceRef) {
    const existingBySource = await prisma.paymentVerification.findFirst({
      where: { companyId: input.companyId, sourceRef: input.sourceRef },
    })
    if (existingBySource) {
      return prisma.paymentVerification.update({
        where: { id: existingBySource.id },
        data: {
          amount: input.amount,
          channel: input.channel,
          date: input.date,
          customerName: input.customerName ?? existingBySource.customerName,
          paidAt: input.paidAt ?? existingBySource.paidAt,
          status: input.source === 'SYSTEM_GENERATED' ? 'VERIFIED' : existingBySource.status,
          verifiedAt: input.source === 'SYSTEM_GENERATED' ? new Date() : existingBySource.verifiedAt,
        },
      })
    }
  }

  if (input.reference) {
    const existingVerified = await prisma.paymentVerification.findFirst({
      where: { companyId: input.companyId, channel: input.channel, reference: input.reference, amount: input.amount, status: 'VERIFIED' },
    })
    if (existingVerified) {
      return prisma.paymentVerification.create({
        data: {
          companyId: input.companyId,
          outletId: input.outletId ?? null,
          date: input.date,
          reference: input.reference,
          channel: input.channel,
          amount: input.amount,
          customerName: input.customerName ?? null,
          paidAt: input.paidAt ?? null,
          source: input.source,
          sourceRef: input.sourceRef ?? null,
          status: 'DUPLICATE',
          duplicateOfId: existingVerified.id,
        },
      })
    }
  }

  return prisma.paymentVerification.create({
    data: {
      companyId: input.companyId,
      outletId: input.outletId ?? null,
      date: input.date,
      reference: input.reference ?? null,
      channel: input.channel,
      amount: input.amount,
      customerName: input.customerName ?? null,
      paidAt: input.paidAt ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      status: input.source === 'SYSTEM_GENERATED' ? 'VERIFIED' : 'PENDING',
      verifiedAt: input.source === 'SYSTEM_GENERATED' ? new Date() : null,
    },
  })
}

export async function verifyPaymentVerification(id: string, actor: { userId: string }, matchedStageId?: string | null) {
  const row = await prisma.paymentVerification.findUnique({ where: { id } })
  if (!row) throw new Error('Payment verification not found')
  if (row.status === 'DUPLICATE') throw new Error('Cannot verify a record already flagged as a duplicate')
  return prisma.paymentVerification.update({
    where: { id },
    data: { status: 'VERIFIED', verifiedById: actor.userId, verifiedAt: new Date(), matchedStageId: matchedStageId ?? row.matchedStageId },
  })
}

export async function rejectPaymentVerification(id: string, actor: { userId: string }, failureReason: string) {
  return prisma.paymentVerification.update({
    where: { id },
    data: { status: 'FAILED', verifiedById: actor.userId, failureReason },
  })
}

export async function markPaymentVerificationDuplicate(id: string, duplicateOfId: string) {
  return prisma.paymentVerification.update({ where: { id }, data: { status: 'DUPLICATE', duplicateOfId } })
}

// ─── Internal pilot sources — Cash / Bank / Mobile Money / POS ─────────────
// Phase 1 pilot (§12.3 of the design doc): these three helpers let the
// existing CashRecon/BankRecon/PosPayment write paths create a matching
// PaymentVerification row (source=SYSTEM_GENERATED, auto-VERIFIED — the
// event already happened inside this system) without re-entering anything.
// Wired in from app/api/cash-recon and app/api/bank-recon once an officer's
// verifiedAmount is set; PosPayment call site still pending.

export async function syncFromCashRecon(cashReconId: string) {
  const row = await prisma.cashRecon.findUnique({ where: { id: cashReconId } })
  // Only sync once an officer has physically verified the cash — verifiedAmount
  // is the figure that should be recorded as VERIFIED, never the unverified
  // reported deposit (which can differ from what was actually counted).
  if (!row || !row.outletId || row.verifiedAmount == null) return null
  const outlet = await prisma.outlet.findUnique({ where: { id: row.outletId }, select: { companyId: true } })
  if (!outlet?.companyId) return null
  return createPaymentVerification({
    companyId: outlet.companyId,
    outletId: row.outletId,
    date: row.date,
    channel: 'CASH',
    amount: row.verifiedAmount,
    source: 'SYSTEM_GENERATED',
    sourceRef: `CashRecon:${row.id}`,
  })
}

export async function syncFromBankRecon(bankReconId: string) {
  const row = await prisma.bankRecon.findUnique({ where: { id: bankReconId } })
  // Only sync once an officer has verified the bank/channel figure —
  // verifiedAmount is the confirmed amount, never the unverified reportedAmount.
  if (!row || !row.outletId || !row.channel || row.verifiedAmount == null) return null
  const outlet = await prisma.outlet.findUnique({ where: { id: row.outletId }, select: { companyId: true } })
  if (!outlet?.companyId) return null
  return createPaymentVerification({
    companyId: outlet.companyId,
    outletId: row.outletId,
    date: row.date,
    channel: row.channel,
    amount: row.verifiedAmount,
    source: 'SYSTEM_GENERATED',
    sourceRef: `BankRecon:${row.id}`,
  })
}

export async function syncFromPosPayment(posPaymentId: string) {
  const row = await prisma.posPayment.findUnique({ where: { id: posPaymentId }, include: { order: true } })
  if (!row) return null
  const outlet = await prisma.outlet.findUnique({ where: { id: row.order.outletId }, select: { companyId: true } })
  if (!outlet?.companyId) return null
  return createPaymentVerification({
    companyId: outlet.companyId,
    outletId: row.order.outletId,
    date: row.createdAt,
    channel: row.method,
    amount: row.amount,
    source: 'SYSTEM_GENERATED',
    sourceRef: `PosPayment:${row.id}`,
  })
}
