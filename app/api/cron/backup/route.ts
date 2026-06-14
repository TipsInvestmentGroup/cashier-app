import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { dumpDatabase } from '@/lib/backup'
import { sendMail } from '@/lib/email'
import { format } from 'date-fns'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Database backup.
 *  - Weekly Vercel cron calls this → emails a JSON backup to directors/admins.
 *  - Manual download: /api/cron/backup?secret=<CRON_SECRET>&download=1
 * Protected by CRON_SECRET (?secret=, x-cron-secret header, or Vercel's Bearer).
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })

  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const provided = req.nextUrl.searchParams.get('secret') || req.headers.get('x-cron-secret') || bearer
  if (provided !== secret) return NextResponse.json({ error: 'Invalid cron secret' }, { status: 401 })

  const dump = await dumpDatabase()
  const json = JSON.stringify(dump)
  const filename = `tips-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`

  // Manual download mode
  if (req.nextUrl.searchParams.get('download') === '1') {
    return new NextResponse(json, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` },
    })
  }

  // Email mode (cron): send to directors + admins
  const recipients = await prisma.user.findMany({
    where: { role: { in: ['DIRECTOR', 'ADMIN'] }, isActive: true, email: { not: '' } },
    select: { email: true },
  })
  let to = recipients.map((r) => r.email).filter(Boolean)
  if (to.length === 0) {
    const fallback = process.env.SMTP_FROM || process.env.NEXT_PUBLIC_OWNER_EMAIL
    if (fallback) to = [fallback]
  }
  if (to.length === 0) return NextResponse.json({ error: 'No backup recipients found' }, { status: 400 })

  const rows = Object.entries(dump.counts).map(([k, v]) => `<tr><td style="padding:2px 10px">${k}</td><td style="padding:2px 10px;text-align:right"><b>${v}</b></td></tr>`).join('')
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif">
      <h2>🗄️ tips — Database Backup</h2>
      <p>Generated: ${dump.generatedAt}</p>
      <p>The full backup is attached as <b>${filename}</b>. Keep it somewhere safe (e.g. Google Drive).</p>
      <table style="border-collapse:collapse;font-size:13px">${rows}</table>
    </div>`

  const result = await sendMail({
    to,
    subject: `tips Database Backup — ${format(new Date(), 'dd MMM yyyy')}`,
    html,
    attachments: [{ filename, content: Buffer.from(json), contentType: 'application/json' }],
  })

  const sys = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'ACCOUNTANT'] }, isActive: true }, select: { id: true } })
  if (sys) {
    await prisma.auditLog.create({
      data: { userId: sys.id, action: 'CRON_BACKUP', entity: 'Database', details: `Backup emailed to ${to.join(', ')} via ${result.mode}.` },
    })
  }

  return NextResponse.json({ ok: true, recipients: to, mode: result.mode, counts: dump.counts })
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
