import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { dumpDatabase } from '@/lib/backup'
import { sendMail } from '@/lib/email'
import { requireCronSecret } from '@/lib/cron-auth'
import { forEachCompany, listActiveCompanies } from '@/lib/tenant'
import { runAsCompany } from '@/lib/tenant-context'
import { ownerEmail } from '@/lib/owner'
import { format } from 'date-fns'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Database backup.
 *  - Weekly Vercel cron calls this → emails a JSON backup to directors/admins.
 *  - Manual download: GET /api/cron/backup?download=1 with the header
 *    `x-cron-secret: <CRON_SECRET>` (never put the secret in the URL).
 * Protected by CRON_SECRET (x-cron-secret header, or Vercel's Bearer).
 * The dump never contains credential material (password/PIN/reset-token hashes).
 */
async function handle(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  // Manual download mode: ONE company's data. With a single company that is everything (as before); with several the
  // caller must say which (?company=<code>) - a backup never mixes companies.
  if (req.nextUrl.searchParams.get('download') === '1') {
    const companies = await listActiveCompanies()
    const wanted = (req.nextUrl.searchParams.get('company') || '').trim().toLowerCase()
    const target = wanted ? companies.find((c) => (c.slug || '').toLowerCase() === wanted || c.id === wanted) : companies.length === 1 ? companies[0] : undefined
    if (!target) return NextResponse.json({ error: companies.length > 1 ? 'Add ?company=<code> - backups are per company' : 'Company not found' }, { status: companies.length > 1 || wanted ? 400 : 404 })
    const dump = await runAsCompany(target.id, () => dumpDatabase({ includeSettings: target.isOriginal }))
    const filename = `${target.slug || 'backup'}-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`
    return new NextResponse(JSON.stringify(dump), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` },
    })
  }

  // Email mode (cron): each company's backup goes ONLY to that company's directors/admins.
  const results = await forEachCompany(async (c) => {
    const dump = await dumpDatabase({ includeSettings: c.isOriginal })
    const json = JSON.stringify(dump)
    const filename = `${c.slug || 'tips'}-backup-${format(new Date(), 'yyyy-MM-dd-HHmm')}.json`

    const recipients = await prisma.user.findMany({
      where: { role: { in: ['DIRECTOR', 'ADMIN'] }, isActive: true, email: { not: '' } },
      select: { email: true },
    })
    let to = recipients.map((r) => r.email).filter(Boolean)
    if (to.length === 0 && c.isOriginal) {
      const fallback = process.env.SMTP_FROM || ownerEmail()
      if (fallback) to = [fallback]
    }
    if (to.length === 0) throw new Error('No backup recipients found')
    return sendCompanyBackup({ dump, json, filename, to, company: c.name })
  })
  if (results.length === 1) {
    const r = results[0]
    return r.ok ? NextResponse.json({ ok: true, ...r.value }) : NextResponse.json({ error: r.error || 'Backup failed' }, { status: 400 })
  }
  const anyOk = results.some((r) => r.ok)
  return NextResponse.json({ ok: anyOk, companies: results.map((r) => ({ company: r.company, ok: r.ok, ...(r.ok ? { recipients: (r.value as { recipients: string[] }).recipients } : { error: r.error }) })) }, { status: anyOk ? 200 : 500 })
}

async function sendCompanyBackup({ dump, json, filename, to, company }: { dump: Awaited<ReturnType<typeof dumpDatabase>>; json: string; filename: string; to: string[]; company: string }) {

  const rows = Object.entries(dump.counts).map(([k, v]) => `<tr><td style="padding:2px 10px">${k}</td><td style="padding:2px 10px;text-align:right"><b>${v}</b></td></tr>`).join('')
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif">
      <h2>🗄️ ${company} — Database Backup</h2>
      <p>Generated: ${dump.generatedAt}</p>
      <p>The full backup is attached as <b>${filename}</b>. Keep it somewhere safe (e.g. Google Drive).</p>
      <table style="border-collapse:collapse;font-size:13px">${rows}</table>
    </div>`

  const result = await sendMail({
    to,
    subject: `${company} Database Backup — ${format(new Date(), 'dd MMM yyyy')}`,
    html,
    attachments: [{ filename, content: Buffer.from(json), contentType: 'application/json' }],
  })

  const sys = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'ACCOUNTANT'] }, isActive: true }, select: { id: true } })
  if (sys) {
    await prisma.auditLog.create({
      data: { userId: sys.id, action: 'CRON_BACKUP', entity: 'Database', details: `Backup emailed to ${to.join(', ')} via ${result.mode}.` },
    })
  }

  return { recipients: to, mode: result.mode, counts: dump.counts }
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
