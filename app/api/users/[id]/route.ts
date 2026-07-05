import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, hashPassword } from '@/lib/auth'
import { VALID_ROLES } from '@/lib/shared-constants'

const OWNER_EMAIL = process.env.NEXT_PUBLIC_OWNER_EMAIL || ''
const PIN_RE = /^\d{4}$/

function isOwner(email?: string) {
  return !!OWNER_EMAIL && !!email && email.toLowerCase() === OWNER_EMAIL.toLowerCase()
}

/** Edit a user — system owner only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can edit users' }, { status: 403 })

  const { id } = await params
  const body = await req.json()
  const { name, email, role, outletId, isActive, password, pin, position } = body
  if (pin && !PIN_RE.test(String(pin))) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
  if (role !== undefined && !VALID_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (name !== undefined) data.name = name
  if (email !== undefined) data.email = email
  if (role !== undefined) data.role = role
  if (outletId !== undefined) data.outletId = outletId || null
  if (isActive !== undefined) data.isActive = !!isActive
  if (password) data.password = await hashPassword(password)
  if (position !== undefined) data.position = position || null
  // Setting a new PIN also clears any active lockout — a manager handing out
  // a fresh PIN shouldn't inherit a prior lockout window.
  if (pin) { data.pin = await hashPassword(String(pin)); data.pinFailedAttempts = 0; data.pinLockedUntil = null }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, position: true, outlet: true, isActive: true, createdAt: true },
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'User', entityId: id, details: `Edited ${updated.email}` } })
    return NextResponse.json(updated)
  } catch (err: unknown) {
    const msg = err instanceof Error && err.message.includes('Unique') ? 'That email is already in use' : 'Could not update user'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

/** Delete a user — system owner only. Blocks if the user has linked records. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can delete users' }, { status: 403 })

  const { id } = await params
  if (id === user.userId) return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })

  // Block delete if the user has linked records (keeps history intact) — suggest deactivate
  const [colls, signed, paid] = await Promise.all([
    prisma.dailyCollection.count({ where: { cashierId: id } }),
    prisma.signedBill.count({ where: { cashierId: id } }),
    prisma.paidBill.count({ where: { cashierId: id } }),
  ])
  if (colls + signed + paid > 0) {
    return NextResponse.json({ error: 'This user has recorded transactions — deactivate them instead of deleting (to keep history).' }, { status: 409 })
  }

  // Remove their audit logs first (no useful history without the user), then delete
  await prisma.auditLog.deleteMany({ where: { userId: id } })
  await prisma.user.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
