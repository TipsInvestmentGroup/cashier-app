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
