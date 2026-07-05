import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateResetToken } from '@/lib/auth'
import { sendMail } from '@/lib/email'

const GENERIC_MESSAGE = 'If that email is registered, a reset link has been sent.'

/**
 * POST /api/auth/forgot-password — body: { email }
 * Always responds with the same generic message whether or not the email
 * exists, so the endpoint can't be used to enumerate registered accounts.
 * Only actually sends an email when a matching, active user is found.
 */
export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json().catch(() => ({}))
    if (!email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase().trim() } })

    let previewUrl: string | undefined
    if (user && user.isActive) {
      const { token, tokenHash, expiresAt } = generateResetToken()
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken: tokenHash, resetTokenExpiry: expiresAt },
      })

      const resetLink = `${req.nextUrl.origin}/reset-password?token=${token}`
      const html = `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#4f46e5">Reset your password</h2>
          <p>Hi ${user.name},</p>
          <p>We received a request to reset your Cashier Management password. This link expires in 1 hour.</p>
          <p style="margin:24px 0">
            <a href="${resetLink}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Reset Password</a>
          </p>
          <p style="color:#666;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
          <p style="color:#999;font-size:12px">${resetLink}</p>
        </div>`

      const result = await sendMail({ to: [user.email], subject: 'Reset your Cashier Management password', html })
      previewUrl = result.mode === 'ethereal' ? (result.previewUrl || undefined) : undefined

      await prisma.auditLog.create({
        data: { userId: user.id, action: 'FORGOT_PASSWORD', entity: 'User', entityId: user.id, details: 'Password reset link requested' },
      })
    }

    // previewUrl only appears when no real SMTP is configured (dev), so a
    // developer can click through without needing a live mailbox.
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE, ...(previewUrl ? { previewUrl } : {}) })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
