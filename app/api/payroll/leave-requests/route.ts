import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createLeaveRequest } from '@/lib/payroll-leave'

// Leave requests (Phase 4b). Supervisor-gated in this phase (a self-service
// employee portal is Phase 5). GET lists; POST creates a PENDING request.
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const where: Record<string, unknown> = {}
  const status = searchParams.get('status')
  if (status) where.status = status
  const employeeId = searchParams.get('employeeId')
  if (employeeId) where.employeeId = employeeId
  const requests = await prisma.leaveRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, include: { leaveType: { select: { code: true, name: true, paid: true } } } })
  return NextResponse.json({ requests })
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (!body.employeeId || !body.leaveTypeId || !body.startDate || !body.endDate) {
    return NextResponse.json({ error: 'employeeId, leaveTypeId, startDate, endDate are required' }, { status: 400 })
  }
  const startDate = new Date(body.startDate), endDate = new Date(body.endDate)
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return NextResponse.json({ error: 'Invalid dates' }, { status: 400 })

  try {
    const request = await createLeaveRequest(prisma, {
      employeeId: body.employeeId, leaveTypeId: body.leaveTypeId, startDate, endDate,
      days: typeof body.days === 'number' ? body.days : undefined, reason: body.reason,
      user: { userId: user.userId, role: user.role, name: user.name },
    })
    return NextResponse.json({ request }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to create leave request' }, { status: 400 })
  }
}
