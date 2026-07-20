// Accounting-classification layer for reconciliation differences.
//
// This is the accounting primitive the redesign is built on (see
// docs/excess-reconciliation-accounting-diagnostic.md). Every reconciliation
// difference maps onto exactly one of three classes:
//
//   RECEIVABLE  — money owed TO the company (staff loss/shortage). Settled by
//                 collection (cash receipt or payroll deduction).
//   PAYABLE     — money owed BY the company (customer overpayment/refund,
//                 kitchen-sales transfer). Settled by payout.
//   ADJUSTMENT  — a reconciling item that explains a difference but moves no
//                 third-party money (discount, cancellation, transfer error,
//                 pass-through staff tips, cash over/short pending review).
//                 Audit-only; never a settle-able obligation.
//
// It is deliberately DECOUPLED from the legacy `category`
// (PAYABLE_EXCESS | NON_PAYABLE | STAFF_LOSS), which is overloaded: it also
// drives collection-form placement (overage vs shortfall picker) and the
// current Excess-Recon ledger filter. Because the class is resolved from the
// reason CODE first, it stays correct even where a deployment's `category`
// has drifted (e.g. CUSTOMER_EXCESS seeded as NON_PAYABLE in an old DB).
export type AccountingClass = 'RECEIVABLE' | 'PAYABLE' | 'ADJUSTMENT'

export const ACCOUNTING_CLASSES: AccountingClass[] = ['RECEIVABLE', 'PAYABLE', 'ADJUSTMENT']

export const ACCOUNTING_CLASS_LABEL: Record<AccountingClass, string> = {
  RECEIVABLE: 'Receivable (owed to company)',
  PAYABLE: 'Payable (owed by company)',
  ADJUSTMENT: 'Adjustment / Investigation',
}

// Policy-fixed class for known reason codes (decisions locked 2026-07-21):
//   Staff tips are handed to staff at point of collection (pass-through) →
//     ADJUSTMENT, not a tracked company payable.
//   Kitchen sales collected at the bar belong to the kitchen department →
//     PAYABLE (inter-department transfer).
//   Customer overpayment / duplicate payment → PAYABLE (owed back).
//   Staff loss / cash shortage → RECEIVABLE (owed to the company).
// A reason code listed here always wins over the legacy category, so this map
// is what corrects historical category drift.
export const CLASS_BY_REASON_CODE: Record<string, AccountingClass> = {
  STAFF_LOSS: 'RECEIVABLE',
  CASH_SHORTAGE: 'RECEIVABLE',
  CUSTOMER_EXCESS: 'PAYABLE',
  DUPLICATE_PAYMENT: 'PAYABLE',
  KITCHEN_SALES: 'PAYABLE',
  OTHERS: 'PAYABLE', // payable-side "Others" (over-collection) — payable pending a precise reason
  STAFF_TIP: 'ADJUSTMENT',
  SIGNED_BILL: 'ADJUSTMENT',
  CANCELLATION: 'ADJUSTMENT',
  DISCOUNT: 'ADJUSTMENT',
  COMPLIMENTARY: 'ADJUSTMENT',
  CUSTOMER_WALK_AWAY: 'ADJUSTMENT',
  TRANSFER_ERROR: 'ADJUSTMENT',
  CASH_OVER: 'ADJUSTMENT',
  OTHER: 'ADJUSTMENT', // shortfall-side "Other" (audit-only)
}

// Fallback when a code isn't explicitly mapped: derive from the legacy
// category. UNASSIGNED and anything unknown default to ADJUSTMENT so an
// unclassified difference is never silently treated as a real obligation.
const CLASS_BY_CATEGORY: Record<string, AccountingClass> = {
  STAFF_LOSS: 'RECEIVABLE',
  PAYABLE_EXCESS: 'PAYABLE',
  NON_PAYABLE: 'ADJUSTMENT',
}

/**
 * Resolve the accounting class for a reconciliation difference: reason code
 * first (policy), then the legacy category, defaulting to ADJUSTMENT.
 */
export function classForReason(code?: string | null, category?: string | null): AccountingClass {
  if (code && CLASS_BY_REASON_CODE[code]) return CLASS_BY_REASON_CODE[code]
  if (category && CLASS_BY_CATEGORY[category]) return CLASS_BY_CATEGORY[category]
  return 'ADJUSTMENT'
}
