import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createPayrollRun, calculateRun } from '@/lib/payroll-run'

// Payroll runs (Phase 3). Supervisor-gated. Creating a run requires the module
// to be enabled (enforced in createPayrollRun); posting writes real GL entries.
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const where: Record<string, unknown> = {}
  const status = searchParams.get('status')
  if (status) where.status = status
  const periodKey = searchParams.get('periodKey')
  if (periodKey) where.periodKey = periodKey

  const runs = await prisma.payrollRun.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
  return NextResponse.json({ runs })
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const runUser = { userId: user.userId, role: user.role, name: user.name }
  const dateParam = body.date ? new Date(body.date) : undefined
  if (dateParam && isNaN(dateParam.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  try {
    const run = await createPayrollRun(prisma, {
      outletId: body.outletId ?? null,
      payGroupId: body.payGroupId ?? null,
      runType: body.runType ?? 'REGULAR',
      date: dateParam,
      user: runUser,
    })
    // Calculate immediately so the caller gets payslip totals in one round-trip.
    const calculated = await calculateRun(prisma, run.id, runUser)
    return NextResponse.json({ run: calculated }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to create run' }, { status: 400 })
  }
}
