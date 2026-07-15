// Single source of truth for "excess amount" reasons, shared by Cashier Cash
// Reconciliation and Cashier Collections so both write the same values into
// CashReconExcess.reason / CollectionExcess.reason for Excess Recon to merge.
export const EXCESS_REASONS = [
  { value: 'KITCHEN_SALES', label: 'Kitchen Sales' },
  { value: 'STAFF_TIP', label: 'Staff Tip' },
  { value: 'CUSTOMER_EXCESS', label: 'Customer Excess' },
  { value: 'OTHERS', label: 'Others' },
] as const

export type ExcessReason = (typeof EXCESS_REASONS)[number]['value']

export const EXCESS_REASON_VALUES: string[] = EXCESS_REASONS.map((r) => r.value)

export const excessReasonLabel = (value: string): string => EXCESS_REASONS.find((r) => r.value === value)?.label || value
