import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { computeAdminDirectorBills } from '@/lib/payroll'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const report = await computeAdminDirectorBills({
    month: searchParams.get('month'),
    outletId: searchParams.get('outletId'),
  })
  return NextResponse.json(report)
}
