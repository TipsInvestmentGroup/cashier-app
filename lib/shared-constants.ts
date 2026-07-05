// Constants shared between server code (lib/petty-access.ts) and client
// components. Kept dependency-free (no prisma import) so client components
// can import this file directly without pulling in server-only code.

// Fixed users who can always manage Departments & Functions (besides the
// owner) and who are the petty-cash / cancellation approvers.
export const DEPT_FIXED_MANAGERS = ['siyer.mkama@tips.co.tz', 'r.mlay@tips.co.tz']
export const PETTY_APPROVERS = ['siyer.mkama@tips.co.tz', 'r.mlay@tips.co.tz']
export const CANCELLATION_APPROVERS = PETTY_APPROVERS

// The full set of valid User.role values. The column itself is a plain
// String (SQLite has no native enum support), so nothing in the schema
// stops an API caller from writing an arbitrary string here — validate
// against this list wherever role is set.
export const VALID_ROLES = ['CASHIER', 'WAITER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

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

// Stock-transfer requests: today only VIP Counter staff can call for backup
// stock from the Main Drinks Counter when the VIP counter runs out of a
// product — keyed by the requester's position so another counter pair can be
// added later without touching the request-handling code.
export const STOCK_REQUEST_ROUTES: Record<string, { from: string; to: string }> = {
  'VIP BAR': { from: 'VIP', to: 'MAIN' },
}
// Reverse lookup: which position is asked to supply a given counter code.
export const SUPPLIER_POSITION: Record<string, string> = { MAIN: 'BAR LADY' }
