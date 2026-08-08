import { prisma } from '@/lib/prisma'
import type { Db } from '@/lib/ledger'
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
  // Daily Report draft lifecycle
  | 'DAILY_REPORT_REVIEW'
  // Expense & Disbursement Framework workflow notifications
  | 'EXPENSE_REQUEST_SUBMITTED'
  | 'EXPENSE_REQUEST_APPROVAL_NEEDED'
  | 'EXPENSE_REQUEST_APPROVED'
  | 'EXPENSE_REQUEST_REJECTED'
  | 'EXPENSE_REQUEST_READY_FOR_PAYMENT'
  | 'EXPENSE_REQUEST_PARTIALLY_PAID'
  | 'EXPENSE_REQUEST_PAID'
  // Petty cash top-up flow (§8) — the reversed direction. Submitted/approval-
  // needed/rejected reuse the EXPENSE_REQUEST_* types above (an approver just
  // sees "awaiting approval"; the purpose text says it is a top-up); only the
  // terminal "funds are now in the fund" confirmation is top-up-specific.
  | 'EXPENSE_TOPUP_ALLOCATED'
  // Custodian Report Phase B2 (§2.2). A fully-approved Petty Cash top-up no
  // longer credits the fund on the spot: it waits for the Digital Expenses
  // Custodian to pay it out of a chosen digital account. This is the "action
  // needed" routed to that custodian (usersWithGrant CUSTODIAN/DIGITAL), NOT to
  // the requester or the cashier.
  | 'EXPENSE_TOPUP_PAYMENT_NEEDED'

/**
 * Create one notification. Pass `db` (a transaction client) when calling from
 * inside a `prisma.$transaction` so the write runs on the SAME connection as
 * the surrounding work — awaiting the global client mid-transaction stalls on a
 * connection-limited pool (serverless/Neon) and locks on single-connection
 * SQLite, which is how expense-approval notifications were being silently lost.
 * Defaults to the global client for the many callers outside a transaction.
 */
export async function createNotification(
  input: {
    userId: string
    type: NotificationType
    title: string
    message: string
    entityType?: string
    entityId?: string
  },
  db: Db = prisma,
) {
  return db.notification.create({
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

/**
 * Fan out one notification to every active user holding a literal `User.role`
 * string (e.g. "MANAGER") for the given outlet — the Expense & Disbursement
 * Framework's RequestType.approverRoles is a JSON array of role strings, not
 * a RolePermission resource, so it needs this simpler sibling to
 * notifyResourceHolders. Same single-outlet-role scoping convention: cross-
 * outlet management roles always qualify, CASHIER/WAITER only for their own
 * outlet.
 */
export async function notifyUsersByRole(
  role: string,
  outletId: string | null,
  input: Omit<Parameters<typeof createNotification>[0], 'userId'>
) {
  const users = await prisma.user.findMany({ where: { role, isActive: true }, select: { id: true, role: true, outletId: true } })
  const targets = users.filter((u) => !isSingleOutletRole(u.role) || !outletId || u.outletId === outletId)
  if (!targets.length) return
  await prisma.notification.createMany({
    data: targets.map((u) => ({
      userId: u.id,
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    })),
  })
}
