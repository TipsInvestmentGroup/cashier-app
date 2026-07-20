import { prisma } from '@/lib/prisma'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
export { OWNER_EMAIL }

export function isOwner(email?: string) {
  return !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL
}

export const RESOURCES = {
  PAID_BILLS: 'PAID_BILLS',
  SIGNED_BILLS: 'SIGNED_BILLS',
  PERSONS: 'PERSONS',
  PRODUCTS: 'PRODUCTS',
  EXCESS_RECON: 'EXCESS_RECON',
  COLLECTION_TEMPLATES: 'COLLECTION_TEMPLATES',
  COLLECTION_APPROVALS: 'COLLECTION_APPROVALS',
  FINANCE_ACCOUNTS: 'FINANCE_ACCOUNTS',
  FINANCE_PERIODS: 'FINANCE_PERIODS',
  FINANCE_PAYABLES: 'FINANCE_PAYABLES',
  FINANCE_RECEIVABLES: 'FINANCE_RECEIVABLES',
  FINANCE_BANKING: 'FINANCE_BANKING',
  FINANCE_BUDGETS: 'FINANCE_BUDGETS',
  FINANCE_RECONCILIATION: 'FINANCE_RECONCILIATION',
} as const

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES]
export type Action = 'add' | 'edit' | 'delete' | 'settle' | 'unsettle'

// Business Day Exception Management — boolean-only resources (no
// add/edit/delete/settle/unsettle shape), resolved via resolveResourcePermission
// below instead of hasPermission/ACTION_FIELD.
export const BUSINESS_DAY_RESOURCES = {
  VIEW_BUSINESS_DAYS: 'VIEW_BUSINESS_DAYS',
  CLOSE_BUSINESS_DAY: 'CLOSE_BUSINESS_DAY',
  UNLOCK_BUSINESS_DAY: 'UNLOCK_BUSINESS_DAY',
  APPROVE_UNLOCK: 'APPROVE_UNLOCK',
  EDIT_CLOSED_RECORDS: 'EDIT_CLOSED_RECORDS',
  VIEW_BUSINESS_DAY_AUDIT_LOG: 'VIEW_BUSINESS_DAY_AUDIT_LOG',
} as const

export type BusinessDayResource = (typeof BUSINESS_DAY_RESOURCES)[keyof typeof BUSINESS_DAY_RESOURCES]

const ACTION_FIELD: Record<Action, 'canAdd' | 'canEdit' | 'canDelete' | 'canSettle' | 'canUnsettle'> = {
  add: 'canAdd', edit: 'canEdit', delete: 'canDelete', settle: 'canSettle', unsettle: 'canUnsettle',
}

/** Owner always passes. Otherwise looks up the explicit grant row. */
export async function hasPermission(email: string | undefined, userId: string | undefined, resource: Resource, action: Action): Promise<boolean> {
  if (isOwner(email)) return true
  if (!userId) return false
  const perm = await prisma.userPermission.findUnique({ where: { userId_resource: { userId, resource } } })
  if (!perm) return false
  return !!perm[ACTION_FIELD[action]]
}

/** All grants for a resource, owner-only endpoint. */
export async function listPermissions(resource: Resource) {
  return prisma.userPermission.findMany({
    where: { resource },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
}

/** Owner sets/changes a user's grant for a resource. */
export async function setPermission(resource: Resource, userId: string, grants: { canAdd?: boolean; canEdit?: boolean; canDelete?: boolean; canSettle?: boolean; canUnsettle?: boolean }) {
  return prisma.userPermission.upsert({
    where: { userId_resource: { userId, resource } },
    update: grants,
    create: { userId, resource, canAdd: !!grants.canAdd, canEdit: !!grants.canEdit, canDelete: !!grants.canDelete, canSettle: !!grants.canSettle, canUnsettle: !!grants.canUnsettle },
  })
}

/** The caller's own effective permissions across all resources (owner = all true). */
export async function myPermissions(email: string | undefined, userId: string) {
  const owner = isOwner(email)
  const rows = owner ? [] : await prisma.userPermission.findMany({ where: { userId } })
  const byResource = new Map(rows.map((r) => [r.resource, r]))
  const result: Record<Resource, { canAdd: boolean; canEdit: boolean; canDelete: boolean; canSettle: boolean; canUnsettle: boolean }> = {} as never
  for (const resource of Object.values(RESOURCES)) {
    const row = byResource.get(resource)
    result[resource] = {
      canAdd: owner || !!row?.canAdd,
      canEdit: owner || !!row?.canEdit,
      canDelete: owner || !!row?.canDelete,
      canSettle: owner || !!row?.canSettle,
      canUnsettle: owner || !!row?.canUnsettle,
    }
  }
  return result
}

/**
 * Boolean-only resolver for BUSINESS_DAY_RESOURCES (and any future
 * single-flag resource) — separate from hasPermission() so that function's
 * 5-action shape and existing callers stay untouched.
 * Resolution: owner always passes > per-user UserPermission override (its
 * `canAdd` column doubles as the single "allowed" flag for these resources)
 * > RolePermission default for the caller's role > deny.
 */
export async function resolveResourcePermission(
  user: { email?: string; userId: string; role: string },
  resource: BusinessDayResource
): Promise<boolean> {
  if (isOwner(user.email)) return true
  const userRow = await prisma.userPermission.findUnique({ where: { userId_resource: { userId: user.userId, resource } } })
  if (userRow) return !!userRow.canAdd
  const roleRow = await prisma.rolePermission.findUnique({ where: { role_resource: { role: user.role, resource } } })
  return !!roleRow?.allowed
}

/** All role defaults for a resource, owner-only endpoint. */
export async function listRolePermissions(resource: BusinessDayResource) {
  return prisma.rolePermission.findMany({ where: { resource }, orderBy: { role: 'asc' } })
}

/** Owner sets/changes a role's default for a resource. */
export async function setRolePermission(role: string, resource: BusinessDayResource, allowed: boolean) {
  return prisma.rolePermission.upsert({
    where: { role_resource: { role, resource } },
    update: { allowed },
    create: { role, resource, allowed },
  })
}
