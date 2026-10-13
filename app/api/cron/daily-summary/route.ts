import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendDailySummary } from '@/lib/daily-summary-email'
import { requireCronSecret } from '@/lib/cron-auth'
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

  try {
    const result = await sendDailySummary({ date })
    const sys = await prisma.user.findFirst({ where: { role: { in: ['ADMIN', 'ACCOUNTANT'] }, isActive: true }, select: { id: true } })
    if (sys) {
      await prisma.auditLog.create({
        data: { userId: sys.id, action: 'CRON_EMAIL_DAILY_SUMMARY', entity: 'DailyCollection', details: `Daily summary for ${date} sent to ${result.recipients.join(', ')} via ${result.mode}.` },
      })
    }
    return NextResponse.json({ ok: true, ...result })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send daily summary' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return handle(req) }
export async function POST(req: NextRequest) { return handle(req) }
