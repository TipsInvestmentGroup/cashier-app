import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashResetToken, hashPassword } from '@/lib/auth'

/**
 * POST /api/auth/reset-password — body: { token, newPassword }
 * Consumes a single-use forgot-password token: validates it hasn't expired,
 * sets the new password, and clears the token so it can't be replayed.
 */
export async function POST(req: NextRequest) {
  try {
    const { token, newPassword } = await req.json().catch(() => ({}))
    if (!token) return NextResponse.json({ error: 'Reset token is required' }, { status: 400 })
    if (!newPassword || String(newPassword).length < 6) {
      return NextResponse.json({ error: 'New password must be at least 6 characters' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { resetToken: hashResetToken(token) } })
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return NextResponse.json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, { status: 400 })
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { password: await hashPassword(newPassword), resetToken: null, resetTokenExpiry: null },
    })

    await prisma.auditLog.create({
      data: { userId: user.id, action: 'RESET_PASSWORD', entity: 'User', entityId: user.id, details: 'Password reset via forgot-password link' },
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
