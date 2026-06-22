import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, readOutletScope } from '@/lib/auth'
import { sendDailySummary } from '@/lib/daily-summary-email'

const ALLOWED = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** Manually email the daily summary for a given date (?date=, defaults today). */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') || undefined
  const outletId = readOutletScope(user, searchParams.get('outletId'))

  try {
    const result = await sendDailySummary({ date, outletId })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'EMAIL_DAILY_SUMMARY', entity: 'DailyCollection', details: `Daily summary for ${result.date} sent to ${result.recipients.join(', ')} via ${result.mode}.` },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to send' }, { status: 500 })
  }
}
