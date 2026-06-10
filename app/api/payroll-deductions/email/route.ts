import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { sendPayrollReport } from '@/lib/payroll-email'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ['ACCOUNTANT', 'ADMIN', 'MANAGER', 'DIRECTOR'])) {
    return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))

  try {
    const result = await sendPayrollReport({
      month: body.month || 'all',
      outletId: body.outletId,
      recipients: body.recipients,
    })

    await prisma.auditLog.create({
      data: {
        userId: user.userId,
        action: 'EMAIL_PAYROLL_REPORT',
        entity: 'PayrollDeduction',
        details: `Period ${body.month || 'all'} emailed to ${result.recipients.join(', ')} via ${result.mode}.`,
      },
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send email' },
      { status: 500 }
    )
  }
}
