import { prisma } from '@/lib/prisma'
import { isSingleOutletRole } from '@/lib/auth'
import { sendMail } from '@/lib/email'

export type NotificationType =
  | 'MISSING_DATA_DETECTED'
  | 'UNLOCK_REQUESTED'
  | 'UNLOCK_APPROVED'
  | 'UNLOCK_REJECTED'
  | 'UNLOCK_EXPIRED'
  | 'DAY_REOPENED'
  // Reconciliation Workflow Engine
  | 'RECONCILIATION_REMINDER'
  | 'RECONCILIATION_ESCALATION'
  | 'RECONCILIATION_STAGE_CLOSED'
  | 'RECONCILIATION_STAGE_REOPENED'
  | 'PAYMENT_VERIFICATION_FAILED'
  | 'WRITE_OFF_REQUESTED'
  | 'WRITE_OFF_APPROVED'
  | 'WRITE_OFF_REJECTED'

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

/**
 * Fan out to every user holding `resource` for the given outlet, in-app
 * always, and additionally by email when `sendEmail` is true. Used by the
 * Reconciliation Workflow Engine's notifier (lib/reconciliation-notify.ts) —
 * Level 1 reminders are in-app only by default (per stage config), Level 2
 * escalations always add email regardless of config. Email failures are
 * swallowed (logged) so a broken SMTP config never blocks the in-app
 * notification or the caller's own workflow.
 */
export async function notifyResourceHoldersMultiChannel(
  resource: string,
  outletId: string | null,
  input: Omit<Parameters<typeof createNotification>[0], 'userId'>,
  opts: { sendEmail?: boolean; emailSubject?: string; emailHtml?: string } = {}
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

  if (!opts.sendEmail) return
  const withEmail = await prisma.user.findMany({
    where: { id: { in: users.map((u) => u.id) } },
    select: { email: true },
  })
  const to = withEmail.map((u) => u.email).filter((e): e is string => !!e)
  if (!to.length) return
  try {
    await sendMail({
      to,
      subject: opts.emailSubject || input.title,
      html: opts.emailHtml || `<p>${input.message}</p>`,
    })
  } catch (err) {
    console.error('notifyResourceHoldersMultiChannel: email send failed', err)
  }
}
