import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendDailySummary } from '@/lib/daily-summary-email'
import { requireCronSecret } from '@/lib/cron-auth'
import { forEachCompany } from '@/lib/tenant'
import { subDays, format } from 'date-fns'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Scheduled daily cashier summary, emailed to all active Directors.
 * Protected by CRON_SECRET (x-cron-secret header, or Bearer - never the URL).
 * Defaults to YESTERDAY (the day that just closed). Override with ?date=YYYY-MM-DD.
 */
async function handle(req: NextRequest) {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const date = req.nextUrl.searchParams.get('date') || format(subDays(new Date(), 1), 'yyyy-MM-dd')

  // One summary PER COMPANY, each computed and addressed inside that company (the tenant guard confines the outlets,
  // the figures and the directors who receive it), so no company ever sees another's numbers.
  const results = await forEachCompany(async () => {
    const result = await sendDailySummary({ date })
    const sys = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'ACCOUNTANT'] }, isActive: true }, select: { id: true } })
    if (sys) {
      await prisma.auditLog.create({
        data: { userId: sys.id, action: 'CRON_EMAIL_DAILY_SUMMARY', entity: 'DailyCollection', details: `Daily summary for ${date} sent to ${result.recipients.join(', ')} via ${result.mode}.` },
      })
    }
    return result
  })
  if (results.length === 1) {
    // single company: the response shape callers have always had
    const r = results[0]
    return r.ok ? NextResponse.json({ ok: true, ...r.value }) : NextResponse.json({ error: r.error || 'Failed to send daily summary' }, { status: 500 })
  }
  const anyOk = results.some((r) => r.ok)
  return NextResponse.json(
    { ok: anyOk, companies: results.map((r) => ({ company: r.company, ok: r.ok, ...(r.ok ? { recipients: (r.value as { recipients: string[] }).recipients } : { error: r.error }) })) },
    { status: anyOk ? 200 : 500 },
  )
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
