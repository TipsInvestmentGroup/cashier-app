import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, comparePassword, hashPassword } from '@/lib/auth'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
const isOwner = (email?: string) => !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL

/**
 * Change a password.
 *  - Any logged-in user can change THEIR OWN password (must supply current password).
 *  - The system owner can change ANY user's password (by userId), without the current
 *    password — and can change their own too.
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { currentPassword, newPassword, userId } = body
  if (!newPassword || String(newPassword).length < 6) {
    return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 })
  }

  const owner = isOwner(user.email)
  // Owner resetting someone else's (or their own) password by userId — no current-password check
  if (userId && owner) {
    const target = await prisma.user.findUnique({ where: { id: userId } })
    if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    await prisma.user.update({ where: { id: userId }, data: { password: await hashPassword(newPassword) } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'RESET_PASSWORD', entity: 'User', entityId: userId, details: `Owner reset password for ${target.email}` } })
    return NextResponse.json({ ok: true })
  }

  // Self-service change — verify current password
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const ok = await comparePassword(String(currentPassword || ''), me.password)
  if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })

  await prisma.user.update({ where: { id: me.id }, data: { password: await hashPassword(newPassword) } })
  await prisma.auditLog.create({ data: { userId: me.id, action: 'CHANGE_PASSWORD', entity: 'User', entityId: me.id, details: 'Changed own password' } })
  return NextResponse.json({ ok: true })
}
