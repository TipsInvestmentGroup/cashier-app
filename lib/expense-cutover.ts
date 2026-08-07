// Petty-cash → Expense Framework migration switches (see
// docs/expense-disbursement-framework-design.md and the migration plan).
// The Accountant/fund-backed cutover (Phase 2) is unconditional — it never
// touches cash reconciliation, so it shipped live. The Cashier/drawer cutover
// (Phase 3) is gated here: flip to true only once Phase 0's cash-recon fix
// (lib/cash-recon.ts) has been observed through a real reconciliation cycle
// in production — do not flip it as part of shipping this code.
export const CASHIER_CUTOVER_ENABLED = false

// Close-the-Day "Cash Requests" redesign (docs/close-the-day-cash-requests-
// redesign): the legacy single-pool Petty Cash screens (/petty-cash,
// /approvals, /petty-payments) are retired from the Expenses nav in favour of
// the three-fund ledgers + the new Cashier Cash worklist. The code and routes
// are NOT deleted — they stay reachable by direct URL (for admin/debug and old
// audits) but drop out of the nav when this is false. Flip to true only to
// temporarily un-retire them (e.g. to resolve a stray open legacy record the
// migration check surfaced). Default false = retired.
export const LEGACY_PETTY_CASH_ENABLED = false
