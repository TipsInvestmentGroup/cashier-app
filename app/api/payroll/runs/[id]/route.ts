import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { transitionRun, calculateRun } from '@/lib/payroll-run'

const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const ACTIONS = ['recalculate', 'submit', 'approve', 'reject', 'lock', 'post', 'reverse'] as const

/** GET — a run with its payslips (+ lines). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const run = await prisma.payrollRun.findUnique({
    where: { id },
    include: { payslips: { include: { lines: { orderBy: { sortOrder: 'asc' } } }, orderBy: { createdAt: 'asc' } } },
  })
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  return NextResponse.json({ run })
}

/** POST — drive the lifecycle: { action, reason? }. `approve` additionally
 *  requires the user's role to be in the run's approver roles (checked in
 *  transitionRun). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body.action as string
  if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
    return NextResponse.json({ error: `action must be one of: ${ACTIONS.join(', ')}` }, { status: 400 })
  }
  const runUser = { userId: user.userId, role: user.role, name: user.name }

  try {
    const run = action === 'recalculate'
      ? await calculateRun(prisma, id, runUser)
      : await transitionRun(prisma, id, action as 'submit' | 'approve' | 'reject' | 'lock' | 'post' | 'reverse', runUser, body.reason)
    return NextResponse.json({ run })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Transition failed' }, { status: 400 })
  }
}
