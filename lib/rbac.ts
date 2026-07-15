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
} as const

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES]
export type Action = 'add' | 'edit' | 'delete'

const ACTION_FIELD: Record<Action, 'canAdd' | 'canEdit' | 'canDelete'> = {
  add: 'canAdd', edit: 'canEdit', delete: 'canDelete',
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
export async function setPermission(resource: Resource, userId: string, grants: { canAdd?: boolean; canEdit?: boolean; canDelete?: boolean }) {
  return prisma.userPermission.upsert({
    where: { userId_resource: { userId, resource } },
    update: grants,
    create: { userId, resource, canAdd: !!grants.canAdd, canEdit: !!grants.canEdit, canDelete: !!grants.canDelete },
  })
}

/** The caller's own effective permissions across all resources (owner = all true). */
export async function myPermissions(email: string | undefined, userId: string) {
  const owner = isOwner(email)
  const rows = owner ? [] : await prisma.userPermission.findMany({ where: { userId } })
  const byResource = new Map(rows.map((r) => [r.resource, r]))
  const result: Record<Resource, { canAdd: boolean; canEdit: boolean; canDelete: boolean }> = {} as never
  for (const resource of Object.values(RESOURCES)) {
    const row = byResource.get(resource)
    result[resource] = {
      canAdd: owner || !!row?.canAdd,
      canEdit: owner || !!row?.canEdit,
      canDelete: owner || !!row?.canDelete,
    }
  }
  return result
}
