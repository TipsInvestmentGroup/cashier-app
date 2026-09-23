import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { computePayrollReport } from '@/lib/payroll'

// Payroll deductions expose every employee's salary/deduction figures — a
// finance-management report, never visible to cashiers/waiters.
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const report = await computePayrollReport({
    month: searchParams.get('month'),
    outletId: searchParams.get('outletId'),
  })
  return NextResponse.json(report)
}
