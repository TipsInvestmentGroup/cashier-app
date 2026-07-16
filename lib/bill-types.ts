// Canonical vocabulary for SignedBill.billType — a fixed part of the Bill
// Generation Engine (core system, not per-company configurable data; the
// legacy six-code vocabulary and its groupings are wired into approval
// gating, receivables and payroll math, not a company preference).
//
// These groupings used to be re-declared independently across 10+
// report/dashboard/payroll routes (sometimes verbatim, sometimes as
// near-identical variants). Centralizing them here removes the risk of two
// call sites silently drifting apart — this is a pure DRY refactor, not a
// behavior change: every constant below matches exactly what each call site
// already had inline.

/** Every legacy signed-bill type code. */
export const BILL_TYPE_CODES = ['ADMIN', 'DIRECTOR', 'CUSTOMER', 'TIPS', 'DJ', 'STAFF_LOSS'] as const

/** The one type that is a system-computed shortage marker, never manually issued. */
export const STAFF_LOSS_TYPE = 'STAFF_LOSS'

/**
 * Bill types that represent a formal request awaiting sign-off — until
 * approved, they don't count as real debt. All other types (Admin, Director,
 * Staff Loss) are auto-approved/internal and always count.
 */
export const REQUEST_BILL_TYPES = ['CUSTOMER', 'TIPS', 'DJ'] as const

/** Prisma where-fragment gating unpaid signed bills by approval status. */
export function approvalGate() {
  return { OR: [{ approvalStatus: 'APPROVED' }, { billType: { notIn: [...REQUEST_BILL_TYPES] } }] }
}

/** Types representing real credit owed by a person (excludes Staff Loss, an internal shortage marker, not a receivable). */
export const CREDIT_BILL_TYPES = ['ADMIN', 'DIRECTOR', 'CUSTOMER', 'TIPS', 'DJ'] as const

/** The two types that carry a person-level credit limit (payroll-deduction eligible, alongside Staff Loss). */
export const CREDIT_LIMIT_BILL_TYPES = ['ADMIN', 'DIRECTOR'] as const

/** Bill types eligible for payroll-deduction settlement. */
export const PAYROLL_ELIGIBLE_BILL_TYPES = ['ADMIN', 'DIRECTOR', 'STAFF_LOSS'] as const

/** Payer-category buckets on the Daily Cashier report's paid-bills breakdown, plus an "OTHER" catch-all. */
export const PAID_BILL_REPORT_KEYS = ['ADMIN', 'DIRECTOR', 'CUSTOMER', 'STAFF_LOSS', 'OTHER'] as const

/**
 * Maps a PaidBill.payerCategory label to its signed-bill type code, for the
 * Daily Cashier report's paid-bills breakdown. Deliberately scoped to
 * PAID_BILL_REPORT_KEYS (excludes Tips/DJ, which fall into "OTHER" there) —
 * NOT the same as lib/categories.ts' CATEGORY_TO_BILLTYPE, which also maps
 * "Sponsors & Partners" → TIPS for a different consumer.
 */
export const PAID_BILL_CATEGORY_MAP: Record<string, string> = {
  Admin: 'ADMIN', Director: 'DIRECTOR', Customer: 'CUSTOMER', 'Staff Loss': 'STAFF_LOSS',
}

/** Bill types shown in the dashboard's Top Debtors widget. */
export const TOP_DEBTOR_BILL_TYPES = ['CUSTOMER', 'ADMIN', 'DIRECTOR'] as const

/** Request-type groupings feeding the header "pending approvals" bell. */
export const REQUEST_BILL_TYPE_GROUPS = [
  { key: 'customer', types: ['CUSTOMER'] as string[], label: 'Customer bills', href: '/customer-bills' },
  { key: 'tipsdj', types: ['TIPS', 'DJ'] as string[], label: 'Tips & DJ bills', href: '/tips-dj-bills' },
]
