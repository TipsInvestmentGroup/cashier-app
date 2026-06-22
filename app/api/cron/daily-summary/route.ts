import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendDailySummary } from '@/lib/daily-summary-email'
import { subDays, format } from 'date-fns'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Scheduled daily cashier summary, emailed to all active Directors.
 * Protected by CRON_SECRET (?secret=, x-cron-secret header, or Bearer).
 * Defaults to YESTERDAY (the day that just closed). Override with ?date=YYYY-MM-DD.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 500 })
  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const provided = req.nextUrl.searchParams.get('secret') || req.headers.get('x-cron-secret') || bearer
  if (provided !== secret) return NextResponse.json({ error: 'Invalid cron secret' }, { status: 401 })

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
