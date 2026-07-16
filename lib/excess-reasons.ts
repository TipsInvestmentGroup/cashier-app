// Single source of truth for "excess amount" reasons, shared by Cashier Cash
// Reconciliation and Cashier Collections so both write the same values into
// CashReconExcess.reason / CollectionExcess.reason for Excess Recon to merge.
//
// The reason LIST is admin-editable (ExcessReason table, managed at
// /excess-reasons) — these DEFAULTS only seed the table once, on first read.
// Two codes are permanently wired into fixed engine behavior and can't be
// renamed away from: STAFF_TIP unlocks a staff picker, CUSTOMER_EXCESS a
// customer picker (see AddExcessModal.tsx / CashReconForm.tsx) — that's
// business logic, not a company preference, so it stays hard-coded here.
export const EXCESS_REASONS = [
  { value: 'KITCHEN_SALES', label: 'Kitchen Sales' },
  { value: 'STAFF_TIP', label: 'Staff Tip' },
  { value: 'CUSTOMER_EXCESS', label: 'Customer Excess' },
  { value: 'OTHERS', label: 'Others' },
] as const

// Sentinel reason for a CollectionExcess row auto-created by an unattended
// recompute (e.g. a cancellation approval flips a collection's variance from
// loss to excess after it was already saved) — there's no cashier present at
// that moment to pick a real reason, so this flags the row for an accountant
// to assign one later instead of silently dropping the excess. Never offered
// as a user-pickable option (see EXCESS_REASON_VALUES / excessReasonLabel).
export const UNASSIGNED_EXCESS_REASON = 'UNASSIGNED'

export type ExcessReason = (typeof EXCESS_REASONS)[number]['value']

// Static fallback list, used only if the DB is unreachable/empty before
// first seed. Includes UNASSIGNED so it's schema-valid to store, but it's
// kept out of EXCESS_REASONS (the user-facing dropdown options).
export const EXCESS_REASON_VALUES: string[] = [...EXCESS_REASONS.map((r) => r.value), UNASSIGNED_EXCESS_REASON]

export const excessReasonLabel = (value: string): string =>
  value === UNASSIGNED_EXCESS_REASON ? 'Needs reason' : EXCESS_REASONS.find((r) => r.value === value)?.label || value
