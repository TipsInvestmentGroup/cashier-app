// Pure aggregation of one staff member's StaffTransaction rows for a
// Transaction Session — the single source of truth for "how much has this
// staff declared so far," reused by the cashier's per-staff summary
// (app/transaction-sessions/[id]/page.tsx) and the staff's own dashboard
// (app/my-transactions/page.tsx / app/api/my-dashboard). No prisma import —
// safe for client components.

export interface SummarizableTxn {
  id: string
  category: string
  paymentMethod: string | null
  amount: number
  status: string
}

export interface StaffTransactionSummary {
  cash: number
  channelTotals: Record<string, number>
  signedBills: number
  discounts: number
  cancellations: number
  creditSales: number
  grandTotal: number
  pendingApprovals: number
}

/** Aggregates one staff's transactions for a session. Mirrors the per-staff
 *  loop inside app/transaction-sessions/[id]/page.tsx's buildSummaries — keep
 *  both in sync, or better, have that page import this instead of its own copy. */
export function summarizeStaffTransactions(transactions: SummarizableTxn[]): StaffTransactionSummary {
  const s: StaffTransactionSummary = { cash: 0, channelTotals: {}, signedBills: 0, discounts: 0, cancellations: 0, creditSales: 0, grandTotal: 0, pendingApprovals: 0 }

  for (const t of transactions) {
    if (t.status === 'REJECTED') continue
    if (t.status === 'PENDING_APPROVAL') { s.pendingApprovals += 1; continue }
    if (t.category === 'PAYMENT') {
      if ((t.paymentMethod || 'CASH') === 'CASH') s.cash += t.amount
      else s.channelTotals[t.paymentMethod!] = (s.channelTotals[t.paymentMethod!] || 0) + t.amount
      s.grandTotal += t.amount
    } else if (t.category === 'SIGNED_BILL') { s.signedBills += t.amount; s.grandTotal += t.amount }
    else if (t.category === 'DISCOUNT') { s.discounts += t.amount }
    else if (t.category === 'CANCELLATION') { s.cancellations += t.amount }
    else if (t.category === 'CREDIT_SALE') { s.creditSales += t.amount; s.grandTotal += t.amount }
  }
  return s
}

/** How far off System Sales this staff's declarations are — positive = short
 *  (potential staff loss), negative = over (potential excess). Matches the
 *  formula the validate route uses for its auto Staff-Loss/Excess records,
 *  so the "Difference" shown before validation matches what happens after it. */
export function staffDifference(systemSales: number, summary: StaffTransactionSummary): number {
  return Math.round((systemSales - summary.grandTotal - summary.discounts - summary.cancellations) * 100) / 100
}

// Payment channels have no bank/mobile-money field in the schema (see
// PaymentChannel model) — classify by naming convention instead. Every
// channel seeded or admin-added so far fits one of these two buckets; a
// channel matching neither keyword defaults to BANK (the more common case).
const MOBILE_MONEY_HINTS = ['MPESA', 'AIRTEL', 'TIGO', 'HALOTEL', 'VODA', 'MOBILE', 'LIPA']

export function classifyChannel(code: string): 'BANK' | 'MOBILE_MONEY' {
  const c = code.toUpperCase()
  return MOBILE_MONEY_HINTS.some((h) => c.includes(h)) ? 'MOBILE_MONEY' : 'BANK'
}

/** Splits a { channelCode: amount } map into bank vs mobile-money subtotals. */
export function splitChannelTotals(channelTotals: Record<string, number>): { bank: number; mobileMoney: number } {
  let bank = 0, mobileMoney = 0
  for (const [code, amt] of Object.entries(channelTotals)) {
    if (classifyChannel(code) === 'MOBILE_MONEY') mobileMoney += amt
    else bank += amt
  }
  return { bank: Math.round(bank * 100) / 100, mobileMoney: Math.round(mobileMoney * 100) / 100 }
}
