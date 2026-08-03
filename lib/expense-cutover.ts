// Petty-cash → Expense Framework migration switches (see
// docs/expense-disbursement-framework-design.md and the migration plan).
// The Accountant/fund-backed cutover (Phase 2) is unconditional — it never
// touches cash reconciliation, so it shipped live. The Cashier/drawer cutover
// (Phase 3) is gated here: flip to true only once Phase 0's cash-recon fix
// (lib/cash-recon.ts) has been observed through a real reconciliation cycle
// in production — do not flip it as part of shipping this code.
export const CASHIER_CUTOVER_ENABLED = false
