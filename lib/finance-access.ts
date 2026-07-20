// Access control for the Finance Platform screens/APIs. Read access is any
// MGMT_ROLES user (ACCOUNTANT/MANAGER/DIRECTOR/ADMIN — same set already used
// elsewhere for cross-outlet oversight, see lib/auth.ts); mutations
// (posting invoices/payments, editing the Chart of Accounts, locking
// periods) additionally require the ACCOUNTANT/DIRECTOR/ADMIN role, the
// owner override, or an explicit UserPermission grant for the resource —
// same additive-on-top-of-role pattern as lib/rbac.ts.
import { isOwner, hasPermission, type Resource } from '@/lib/rbac'

export function canViewFinance(role?: string): boolean {
  return !!role && ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN'].includes(role)
}

export async function canManageFinance(email: string | undefined, userId: string | undefined, role: string | undefined, resource: Resource): Promise<boolean> {
  if (isOwner(email)) return true
  if (role && ['ACCOUNTANT', 'DIRECTOR', 'ADMIN'].includes(role)) return true
  return hasPermission(email, userId, resource, 'add')
}
