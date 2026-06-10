import nodemailer from 'nodemailer'

export interface MailResult {
  messageId: string
  mode: 'smtp' | 'ethereal'
  previewUrl?: string | false
  accepted: string[]
}

/**
 * Builds a transporter.
 *  - If SMTP_HOST/SMTP_USER/SMTP_PASS are set in env, uses that real SMTP server.
 *  - Otherwise falls back to an Ethereal test account (nodemailer) so emails can
 *    be previewed locally without any setup. The returned previewUrl shows the
 *    rendered email + attachments.
 */
async function getTransporter(): Promise<{ transporter: nodemailer.Transporter; mode: 'smtp' | 'ethereal'; from: string }> {
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS

  if (host && user && pass) {
    const transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    })
    return { transporter, mode: 'smtp', from: process.env.SMTP_FROM || user }
  }

  // No real SMTP configured -> Ethereal test inbox (preview only)
  const testAccount = await nodemailer.createTestAccount()
  const transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  })
  return { transporter, mode: 'ethereal', from: 'Cashier App <reports@cashier-app.local>' }
}

export async function sendMail(opts: {
  to: string[]
  subject: string
  html: string
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[]
}): Promise<MailResult> {
  const { transporter, mode, from } = await getTransporter()
  const info = await transporter.sendMail({
    from,
    to: opts.to.join(', '),
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
  })
  return {
    messageId: info.messageId,
    mode,
    previewUrl: mode === 'ethereal' ? nodemailer.getTestMessageUrl(info) : undefined,
    accepted: (info.accepted as string[]) || [],
  }
}
