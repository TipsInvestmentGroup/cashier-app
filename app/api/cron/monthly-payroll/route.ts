import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendPayrollReport } from '@/lib/payroll-email'
import { subMonths, format } from 'date-fns'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

/**
 * Scheduled monthly payroll report.
 * Trigger this on the 1st of each month (e.g. via Windows Task Scheduler / host cron).
 * Protected by CRON_SECRET (passed as ?secret= or x-cron-secret header).
 *
 * Defaults to the PREVIOUS month (the one that just closed). Override with ?month=YYYY-MM.
 * Accepts GET (easy for schedulers) and POST.
 */
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 500 })
  }
  // Accept the secret via ?secret=, x-cron-secret header, or Vercel Cron's
  // "Authorization: Bearer <CRON_SECRET>" header.
  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const provided = req.nextUrl.searchParams.get('secret') || req.headers.get('x-cron-secret') || bearer
  if (provided !== secret) {
    return NextResponse.json({ error: 'Invalid cron secret' }, { status: 401 })
  }

  const monthOverride = req.nextUrl.searchParams.get('month')
  const month = monthOverride || format(subMonths(new Date(), 1), 'yyyy-MM')

  try {
    const result = await sendPayrollReport({ month })

    // Attribute the audit entry to an admin/accountant if one exists
    const sys = await prisma.user.findFirst({
      where: { role: { in: ['ADMIN', 'ACCOUNTANT'] }, isActive: true },
      select: { id: true },
    })
    if (sys) {
      await prisma.auditLog.create({
        data: {
          userId: sys.id,
          action: 'CRON_EMAIL_PAYROLL_REPORT',
          entity: 'PayrollDeduction',
          details: `Scheduled report for ${month} sent to ${result.recipients.join(', ')} via ${result.mode}.`,
        },
      })
    }

    return NextResponse.json({ ok: true, month, ...result })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send scheduled report' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  return handle(req)
}
export async function POST(req: NextRequest) {
  return handle(req)
}
