import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { computeAdminDirectorBills } from '@/lib/payroll'

// Admin/Director spending oversight — a management report, not for cashiers/waiters.
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const report = await computeAdminDirectorBills({
    month: searchParams.get('month'),
    outletId: searchParams.get('outletId'),
  })
  return NextResponse.json(report)
}
