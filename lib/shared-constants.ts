// Constants shared between server code (lib/petty-access.ts) and client
// components. Kept dependency-free (no prisma import) so client components
// can import this file directly without pulling in server-only code.

// Who can manage Departments & Functions, approve petty cash, and approve
// cancellations now lives in lib/approvals.ts (Setting-table-backed, with
// today's values as the seeded default) instead of being fixed here.

// The full set of valid User.role values. The column itself is a plain
// String (SQLite has no native enum support), so nothing in the schema
// stops an API caller from writing an arbitrary string here — validate
// against this list wherever role is set.
export const VALID_ROLES = ['CASHIER', 'WAITER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

// Fixed cash-verification officers (besides the owner) — server-side access
// grant lives in lib/cash-verify.ts::canVerifyCash, which re-exports this.
// Kept here (not re-typed) so the "extra verifier" dropdown on app/petty-cash
// always excludes exactly the same emails the server already always allows.
export const CASH_VERIFIERS_FIXED = ['shabinam@tips.co.tz', 'siyer.mkama@tips.co.tz', 'derickjasselly@gmail.com']

// MyPos floor staff normally work one physical station, so both the Counter
// View UI (client) and its API (server) lock a staffer to their assigned
// counter(s) by this map. Positions with no entry here (e.g. OUTSIDE STAFF,
// which is explicitly blocked elsewhere) and all management roles fall
// through to seeing every counter.
export const POSITION_COUNTERS: Record<string, string[]> = {
  'VIP BAR': ['VIP'],
  'BAR LADY': ['MAIN'],
  'SHISHA COUNTER': ['SHISHA'],
  'KITCHEN COUNTER': ['KITCHEN'],
}
export const MANAGEMENT_ROLES = ['MANAGER', 'ADMIN', 'DIRECTOR']

// Stock-transfer requests: VIP and Main Bar can each call on the other for
// backup stock when they run out of a product — keyed by the requester's
// position so another counter pair can be added later without touching the
// request-handling code.
export const STOCK_REQUEST_ROUTES: Record<string, { from: string; to: string }> = {
  'VIP BAR': { from: 'VIP', to: 'MAIN' },
  'BAR LADY': { from: 'MAIN', to: 'VIP' },
}
// Reverse lookup: which position is asked to supply a given counter code.
export const SUPPLIER_POSITION: Record<string, string> = { MAIN: 'BAR LADY', VIP: 'VIP BAR' }

// Each product only belongs on the counter(s) that actually stock it: Shisha
// products go to the Shisha counter, food to Kitchen, and everything else
// (drinks, cigarettes, etc.) to VIP Counter or Main Bar/Bar — never Kitchen
// or Shisha. Product.category is free text (no enum), so this is a keyword
// match rather than an exact lookup — case-insensitive, substring-based, so
// seed data like "SHISHA" or a future "Food" category both match cleanly.
export function allowedCountersForCategory(category: string | null | undefined): string[] {
  const cat = (category || '').trim().toUpperCase()
  if (cat.includes('SHISHA')) return ['SHISHA']
  if (cat.includes('FOOD')) return ['KITCHEN']
  return ['VIP', 'MAIN', 'BAR']
}

// SalesMetric.department — the two uploadable metric datasets (Shisha count,
// Food amount; see components/UploadSalesModal.tsx and /api/sales-metrics*).
// Unrelated to allowedCountersForCategory above (that's product routing).
export const SALES_METRIC_DEPARTMENTS = ['SHISHA', 'FOOD'] as const

// ─── Expense module access grants (§4 Manage Access) ─────────────────────────
// The grant vocabulary, kept here rather than in lib/expense-grants.ts because
// that module imports prisma and so cannot be pulled into a client component.
// lib/expense-grants.ts re-exports these for server callers, the same way
// lib/cash-verify.ts re-exports CASH_VERIFIERS_FIXED above — one definition,
// two audiences.
export const EXPENSE_GRANT_TYPES = ['REQUEST', 'CUSTODIAN', 'FIRST_APPROVER', 'SECOND_APPROVER', 'ALLOCATOR'] as const

// ALLOCATOR is reserved, not issued: the Second Approver's approval directly
// executes a petty cash top-up allocation (decision 2026-08-05), so there is no
// separate allocator to staff. The value exists so that splitting execution back
// out later is a config change rather than a migration.
export const EXPENSE_RESERVED_GRANT_TYPES: string[] = ['ALLOCATOR']

// The six access flags exactly as §4 lists them. Note that the three custodian
// flags are one grant type carrying a fund class, not three enum values —
// holding the petty cash float does not make someone the Digital custodian, and
// (grantType, fundClass) says that in one place instead of three branches
// downstream.
export const EXPENSE_GRANT_FLAGS: { grantType: string; fundClass: string | null; label: string; hint: string }[] = [
  { grantType: 'REQUEST', fundClass: null, label: 'Requesting Access', hint: 'May submit an Expense Form.' },
  { grantType: 'CUSTODIAN', fundClass: 'PETTY_CASH', label: 'Petty Cash Custodian', hint: 'Holds and disburses the petty cash float; may request a top-up.' },
  { grantType: 'CUSTODIAN', fundClass: 'DIGITAL', label: 'Digital Expenses Custodian', hint: 'Pays approved requests from the bank/mobile-money account.' },
  { grantType: 'CUSTODIAN', fundClass: 'CASHIER_CASH', label: 'Cashier Cash Custodian', hint: 'Disburses from the cashier drawer.' },
  { grantType: 'FIRST_APPROVER', fundClass: null, label: 'First Approver', hint: 'First stage of the approval chain.' },
  { grantType: 'SECOND_APPROVER', fundClass: null, label: 'Second Approver', hint: 'Final approval — also executes petty cash top-up allocations.' },
]
