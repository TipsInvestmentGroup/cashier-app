import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireActiveUser, hashPassword } from '@/lib/auth'
import { VALID_ROLES } from '@/lib/shared-constants'
import { resolveManageUsersPermission, MANAGE_USERS_RESOURCES } from '@/lib/rbac'
import { memberOfCompanyWhere, outletInCompany, upsertMembership } from '@/lib/tenant'

const PIN_RE = /^\d{4}$/

/** Edit a user — gated by the Manage Access "Edit users" grant (owner always passes). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveManageUsersPermission(user, MANAGE_USERS_RESOURCES.EDIT_USER))) return NextResponse.json({ error: 'You do not have permission to edit users' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { name, email, role, outletId, isActive, password, pin, position, isCasual } = body
  if (pin && !PIN_RE.test(String(pin))) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
  if (role !== undefined && !VALID_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  // Only people in the CALLER'S company can be edited here; anyone else is "not found" (no probing).
  const companyId = user.companyId
  if (!companyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const target = await prisma.user.findFirst({
    where: { id, ...(await memberOfCompanyWhere(prisma, companyId)) },
    select: {
      id: true, role: true, outletId: true, position: true, isActive: true,
      memberships: { where: { companyId }, select: { role: true, outletId: true, position: true, isActive: true } },
    },
  })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (outletId !== undefined && !(await outletInCompany(prisma, outletId || null, companyId))) {
    return NextResponse.json({ error: 'That outlet does not belong to your company' }, { status: 400 })
  }

  // Identity-level fields live on User; company-level ones (role / outlet / position / active) on the
  // membership held in THIS company.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (name !== undefined) data.name = name
  if (email !== undefined) data.email = email
  if (isCasual !== undefined) data.isCasual = !!isCasual
  if (password) data.password = await hashPassword(password)
  // Setting a new PIN also clears any active lockout — a manager handing out
  // a fresh PIN shouldn't inherit a prior lockout window.
  if (pin) { data.pin = await hashPassword(String(pin)); data.pinFailedAttempts = 0; data.pinLockedUntil = null }
  // Revoke the edited user's outstanding tokens the moment their access changes
  // (role/outlet, credentials) so it takes effect immediately. Deactivating them in this company is
  // enforced per-company by the API gate (membership.isActive), without signing them out elsewhere.
  if (role !== undefined || outletId !== undefined || password || pin) {
    data.sessionEpoch = { increment: 1 }
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const cur = target.memberships[0] ?? { role: target.role, outletId: target.outletId, position: target.position, isActive: target.isActive }
      if (Object.keys(data).length) await tx.user.update({ where: { id }, data })
      await upsertMembership(tx, {
        userId: id, companyId,
        role: role !== undefined ? role : cur.role,
        outletId: outletId !== undefined ? (outletId || null) : cur.outletId,
        position: position !== undefined ? (position || null) : cur.position,
        isActive: isActive !== undefined ? !!isActive : cur.isActive,
      })
      // Fully deactivating (inactive in every company) also revokes any token still in flight.
      if (isActive === false && !(await tx.user.findUnique({ where: { id }, select: { isActive: true } }))?.isActive) {
        await tx.user.update({ where: { id }, data: { sessionEpoch: { increment: 1 } } })
      }
      const row = await tx.user.findUniqueOrThrow({
        where: { id },
        select: { id: true, name: true, email: true, role: true, position: true, outlet: true, isActive: true, isCasual: true, createdAt: true },
      })
      const m = await tx.membership.findUnique({ where: { userId_companyId: { userId: id, companyId } } })
      return m ? { ...row, role: m.role, position: m.position, isActive: m.isActive && row.isActive, outlet: m.outletId ? await tx.outlet.findUnique({ where: { id: m.outletId } }) : null } : row
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'User', entityId: id, details: `Edited ${updated.email}` } })
    return NextResponse.json(updated)
  } catch (err: unknown) {
    const msg = err instanceof Error && err.message.includes('Unique') ? 'That email is already in use' : 'Could not update user'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

/** Delete a user — gated by the Manage Access "Delete users" grant (owner always passes). Blocks if the user has linked records. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveManageUsersPermission(user, MANAGE_USERS_RESOURCES.DELETE_USER))) return NextResponse.json({ error: 'You do not have permission to delete users' }, { status: 403 })

  const { id } = await params
  if (id === user.userId) return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })

  // Only people in the CALLER'S company can be removed here.
  const companyId = user.companyId
  if (!companyId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const inCompany = await prisma.user.findFirst({ where: { id, ...(await memberOfCompanyWhere(prisma, companyId)) }, select: { id: true } })
  if (!inCompany) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Block delete if the user has ANY linked record — every one of these is a
  // required (non-cascading) foreign key to User, so missing even one here
  // lets prisma.user.delete() hit an unhandled FK-constraint error and crash
  // with a bare 500 instead of this friendly message.
  const [colls, signed, paid, orders, waiterSessions, scheduleAssignments, unavailability, eventStaff] = await Promise.all([
    prisma.dailyCollection.count({ where: { cashierId: id } }),
    prisma.signedBill.count({ where: { cashierId: id } }),
    prisma.paidBill.count({ where: { cashierId: id } }),
    prisma.posOrder.count({ where: { waiterId: id } }),
    prisma.posWaiterSession.count({ where: { waiterId: id } }),
    prisma.scheduleAssignment.count({ where: { staffId: id } }),
    prisma.staffUnavailability.count({ where: { staffId: id } }),
    prisma.eventStaff.count({ where: { staffId: id } }),
  ])
  if (colls + signed + paid + orders + waiterSessions + scheduleAssignments + unavailability + eventStaff > 0) {
    return NextResponse.json({ error: 'This user has linked records (orders, schedule, transactions, etc.) — deactivate them instead of deleting (to keep history).' }, { status: 409 })
  }

  // A person who also belongs to ANOTHER company is not deleted - they only leave this one.
  const otherMemberships = await prisma.membership.count({ where: { userId: id, companyId: { not: companyId } } })
  if (otherMemberships > 0) {
    await prisma.membership.deleteMany({ where: { userId: id, companyId } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'REMOVE_MEMBER', entity: 'User', entityId: id, details: 'Removed from the company (still a member elsewhere)' } })
    return NextResponse.json({ ok: true, removedFromCompanyOnly: true })
  }

  // Remove their audit logs first (no useful history without the user), then delete
  await prisma.auditLog.deleteMany({ where: { userId: id } })
  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
