import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, hashPassword } from '@/lib/auth'
import { VALID_ROLES } from '@/lib/shared-constants'
import { resolveManageUsersPermission, MANAGE_USERS_RESOURCES } from '@/lib/rbac'

const PIN_RE = /^\d{4}$/

/** Edit a user — gated by the Manage Access "Edit users" grant (owner always passes). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveManageUsersPermission(user, MANAGE_USERS_RESOURCES.EDIT_USER))) return NextResponse.json({ error: 'You do not have permission to edit users' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { name, email, role, outletId, isActive, password, pin, position, isCasual } = body
  if (pin && !PIN_RE.test(String(pin))) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
  if (role !== undefined && !VALID_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (name !== undefined) data.name = name
  if (email !== undefined) data.email = email
  if (role !== undefined) data.role = role
  if (outletId !== undefined) data.outletId = outletId || null
  if (isActive !== undefined) data.isActive = !!isActive
  if (isCasual !== undefined) data.isCasual = !!isCasual
  if (password) data.password = await hashPassword(password)
  if (position !== undefined) data.position = position || null
  // Setting a new PIN also clears any active lockout — a manager handing out
  // a fresh PIN shouldn't inherit a prior lockout window.
  if (pin) { data.pin = await hashPassword(String(pin)); data.pinFailedAttempts = 0; data.pinLockedUntil = null }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, position: true, outlet: true, isActive: true, isCasual: true, createdAt: true },
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
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveManageUsersPermission(user, MANAGE_USERS_RESOURCES.DELETE_USER))) return NextResponse.json({ error: 'You do not have permission to delete users' }, { status: 403 })

  const { id } = await params
  if (id === user.userId) return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })

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

  // Remove their audit logs first (no useful history without the user), then delete
  await prisma.auditLog.deleteMany({ where: { userId: id } })
  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
