import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { payrollRegister, statutoryReport } from '@/lib/payroll-reports'

const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** GET ?type=register|statutory — a report over one run. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const type = new URL(req.url).searchParams.get('type') ?? 'register'
  try {
    if (type === 'register') return NextResponse.json(await payrollRegister(prisma, id))
    if (type === 'statutory') return NextResponse.json(await statutoryReport(prisma, id))
    return NextResponse.json({ error: "type must be 'register' or 'statutory'" }, { status: 400 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Report failed'
    return NextResponse.json({ error: msg }, { status: msg === 'Run not found' ? 404 : 500 })
  }
}
