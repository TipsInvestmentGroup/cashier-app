import { prisma } from '@/lib/prisma'
import { isSingleOutletRole } from '@/lib/auth'

export type NotificationType =
  | 'MISSING_DATA_DETECTED'
  | 'UNLOCK_REQUESTED'
  | 'UNLOCK_APPROVED'
  | 'UNLOCK_REJECTED'
  | 'UNLOCK_EXPIRED'
  | 'DAY_REOPENED'

export async function createNotification(input: {
  userId: string
  type: NotificationType
  title: string
  message: string
  entityType?: string
  entityId?: string
}) {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  })
}

/**
 * Every user who effectively holds `resource` (owner-equivalent role default
 * via RolePermission, or a per-user UserPermission override with canAdd=true),
 * narrowed to those who can actually act on the given outlet: management
 * roles (cross-outlet oversight, per lib/auth.ts SINGLE_OUTLET_ROLES) always
 * qualify; single-outlet roles (CASHIER/WAITER) only qualify for their own
 * outlet.
 */
export async function listUsersWithResourcePermission(resource: string, outletId?: string | null) {
  const [roleRows, userRows] = await Promise.all([
    prisma.rolePermission.findMany({ where: { resource, allowed: true }, select: { role: true } }),
    prisma.userPermission.findMany({ where: { resource, canAdd: true }, select: { userId: true } }),
  ])
  const allowedRoles = roleRows.map((r) => r.role)
  const overrideUserIds = userRows.map((r) => r.userId)

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ role: { in: allowedRoles } }, { id: { in: overrideUserIds } }],
    },
    select: { id: true, role: true, outletId: true },
  })

  return users.filter((u) => !isSingleOutletRole(u.role) || !outletId || u.outletId === outletId)
}

/** Fan out one notification to every user holding `resource` for the given outlet. */
export async function notifyResourceHolders(
  resource: string,
  outletId: string | null,
  input: Omit<Parameters<typeof createNotification>[0], 'userId'>
) {
  const users = await listUsersWithResourcePermission(resource, outletId)
  if (!users.length) return
  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    })),
  })
}
