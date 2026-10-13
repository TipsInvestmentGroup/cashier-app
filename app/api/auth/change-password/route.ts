import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, comparePassword, hashPassword, signToken, type JWTPayload } from '@/lib/auth'
import { limitEveryRequest } from '@/lib/rate-limit'
import { ownerEmail } from '@/lib/owner'

const OWNER_EMAIL = ownerEmail()
const isOwner = (email?: string) => !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL

/**
 * Change a password.
 *  - Any logged-in user can change THEIR OWN password (must supply current password).
 *  - The system owner can change ANY user's password (by userId), without the current
 *    password — and can change their own too.
 */

/** A fresh session token for the caller after their own password changed. Changing a password
 *  revokes every outstanding token (sessionEpoch bump), so the browser that made the change
 *  must be handed a new one or it would be logged out by its own action. */
function freshToken(u: { id: string; email: string; role: string; outletId: string | null; name: string; position: string | null; sessionEpoch: number }): string {
  const payload: JWTPayload = {
    userId: u.id, email: u.email, role: u.role, outletId: u.outletId || undefined,
    name: u.name, position: u.position || undefined, sepoch: u.sessionEpoch,
  }
  return signToken(payload)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Self-service change verifies the current password, so cap guessing of it.
  const limited = limitEveryRequest(req, `chgpw:${user.userId}`, { limit: 10, windowMs: 10 * 60 * 1000 })
  if (limited) return limited

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
    // Owner-forced reset also revokes the target's outstanding tokens.
    const updated = await prisma.user.update({ where: { id: userId }, data: { password: await hashPassword(newPassword), sessionEpoch: { increment: 1 } } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'RESET_PASSWORD', entity: 'User', entityId: userId, details: `Owner reset password for ${target.email}` } })
    // Owner changed their OWN password through this path: keep their session alive.
    return NextResponse.json({ ok: true, ...(updated.id === user.userId ? { token: freshToken(updated) } : {}) })
  }

  // Self-service change — verify current password
  const me = await prisma.user.findUnique({ where: { id: user.userId } })
  if (!me) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  const ok = await comparePassword(String(currentPassword || ''), me.password)
  if (!ok) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })

  // Bump sessionEpoch: a password change must end any other session that still holds the old
  // credential (a stolen token or a forgotten shared-device login). This device gets a new token.
  const updated = await prisma.user.update({ where: { id: me.id }, data: { password: await hashPassword(newPassword), sessionEpoch: { increment: 1 } } })
  await prisma.auditLog.create({ data: { userId: me.id, action: 'CHANGE_PASSWORD', entity: 'User', entityId: me.id, details: 'Changed own password' } })
  return NextResponse.json({ ok: true, token: freshToken(updated) })
}
