// Single source of truth for "Difference Reasons" — shared by the Collection
// form (both the payable/excess side and the non-payable/shortfall side),
// Cash Reconciliation, and Excess Recon, so all write the same values into
// CashReconExcess.reason / CollectionExcess.reason.
//
// The reason LIST is admin-editable (ExcessReason table, managed at
// /excess-reasons) — these DEFAULTS only seed the table once, on first read,
// and backfill `category` for anything the admin hasn't customized (see
// lib/excess-reasons-db.ts). Three codes are permanently wired into fixed
// engine behavior and can't be renamed away from: STAFF_TIP unlocks a staff
// picker, CUSTOMER_EXCESS a customer picker (AddExcessModal.tsx /
// CashReconForm.tsx / the Collection form), and STAFF_LOSS drives the
// existing auto-SignedBill debt path — that's business logic, not a company
// preference, so it stays hard-coded here.
export type DifferenceReasonCategory = 'PAYABLE_EXCESS' | 'NON_PAYABLE' | 'STAFF_LOSS'

export const DIFFERENCE_REASONS = [
  // Payable Business Excess — staff collected MORE than System Sales required;
  // the extra belongs to someone else and is settled later via Excess Payment.
  { value: 'KITCHEN_SALES', label: 'Kitchen Sales', category: 'PAYABLE_EXCESS' as const },
  { value: 'STAFF_TIP', label: 'Staff Tip', category: 'PAYABLE_EXCESS' as const },
  { value: 'CUSTOMER_EXCESS', label: 'Customer Excess', category: 'PAYABLE_EXCESS' as const },
  { value: 'OTHERS', label: 'Others', category: 'PAYABLE_EXCESS' as const },
  // Non-Payable Accounting Reasons — staff collected LESS than System Sales
  // required, explained by money already tracked elsewhere in this same
  // submission (signed bills, cancellations, discount) or a business reason
  // that isn't the staff's liability. Audit-only, never a payable record.
  { value: 'SIGNED_BILL', label: 'Signed Bill', category: 'NON_PAYABLE' as const },
  { value: 'CANCELLATION', label: 'Cancellation', category: 'NON_PAYABLE' as const },
  { value: 'DISCOUNT', label: 'Discount', category: 'NON_PAYABLE' as const },
  { value: 'COMPLIMENTARY', label: 'Complimentary Item', category: 'NON_PAYABLE' as const },
  { value: 'CUSTOMER_WALK_AWAY', label: 'Customer Walk Away', category: 'NON_PAYABLE' as const },
  { value: 'TRANSFER_ERROR', label: 'Transfer Error', category: 'NON_PAYABLE' as const },
  { value: 'OTHER', label: 'Other', category: 'NON_PAYABLE' as const },
  // Staff Loss — genuine unexplained shortfall, own category (not "payable
  // TO someone", it's a debt the staff owes the business). Keeps today's
  // exact auto-SignedBill(STAFF_LOSS) behavior, just requires an explicit
  // pick instead of firing silently on every unexplained shortfall.
  { value: 'STAFF_LOSS', label: 'Staff Loss', category: 'STAFF_LOSS' as const },
] as const

// Reserved codes: engine behavior is wired to these exact strings, so they
// can be relabeled/disabled but never deleted or have their category changed.
export const RESERVED_REASON_CODES = ['STAFF_TIP', 'CUSTOMER_EXCESS', 'STAFF_LOSS']

// Backward-compatible name: the payable-only subset, exactly today's 4-item
// list — used by call sites that only ever deal with payable excess
// (CashReconForm.tsx, the Excess Recon edit modal, AddExcessModal.tsx).
export const EXCESS_REASONS = DIFFERENCE_REASONS.filter((r) => r.category === 'PAYABLE_EXCESS')

// The non-payable + staff-loss subset — offered by the Collection form when
// the difference is a shortfall (System Sales > collected).
export const SHORTFALL_REASONS = DIFFERENCE_REASONS.filter((r) => r.category !== 'PAYABLE_EXCESS')

// Sentinel reason for a CollectionExcess row auto-created by an unattended
// recompute (e.g. a cancellation approval flips a collection's variance from
// loss to excess after it was already saved, or the Transaction Verification
// validate route has no interactive reason picker) — there's no cashier
// present at that moment to pick a real reason, so this flags the row for an
// accountant to assign one later instead of silently dropping the excess.
// Never offered as a user-pickable option (see DIFFERENCE_REASON_VALUES /
// excessReasonLabel).
export const UNASSIGNED_EXCESS_REASON = 'UNASSIGNED'

export type ExcessReason = (typeof EXCESS_REASONS)[number]['value']

// Static fallback list, used only if the DB is unreachable/empty before
// first seed. Includes UNASSIGNED so it's schema-valid to store, but it's
// kept out of DIFFERENCE_REASONS (the user-facing dropdown options).
export const EXCESS_REASON_VALUES: string[] = [...DIFFERENCE_REASONS.map((r) => r.value), UNASSIGNED_EXCESS_REASON]

export const excessReasonLabel = (value: string): string =>
  value === UNASSIGNED_EXCESS_REASON ? 'Needs reason' : DIFFERENCE_REASONS.find((r) => r.value === value)?.label || value
