import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { payrollVariance } from '@/lib/payroll-reports'

const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** GET ?a=<runId>&b=<runId> — headline variance (b − a). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const a = searchParams.get('a'), b = searchParams.get('b')
  if (!a || !b) return NextResponse.json({ error: 'a and b (run ids) are required' }, { status: 400 })
  try {
    return NextResponse.json(await payrollVariance(prisma, a, b))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Variance failed' }, { status: 400 })
  }
}
