// Single source of truth for "excess amount" reasons, shared by Cashier Cash
// Reconciliation and Cashier Collections so both write the same values into
// CashReconExcess.reason / CollectionExcess.reason for Excess Recon to merge.
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

// Includes UNASSIGNED so it's schema-valid to store, but it's kept out of
// EXCESS_REASONS (the user-facing dropdown options).
export const EXCESS_REASON_VALUES: string[] = [...EXCESS_REASONS.map((r) => r.value), UNASSIGNED_EXCESS_REASON]

export const excessReasonLabel = (value: string): string =>
  value === UNASSIGNED_EXCESS_REASON ? 'Needs reason' : EXCESS_REASONS.find((r) => r.value === value)?.label || value
