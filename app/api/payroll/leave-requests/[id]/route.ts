import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { transitionLeaveRequest } from '@/lib/payroll-leave'

const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const ACTIONS = ['approve', 'reject', 'cancel'] as const

/** POST — { action, reason? }. `approve` requires the user's role to be in the
 *  leave type's approver roles (checked in transitionLeaveRequest; ADMIN overrides). */
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
  try {
    const request = await transitionLeaveRequest(prisma, id, action as 'approve' | 'reject' | 'cancel', { userId: user.userId, role: user.role, name: user.name }, body.reason)
    return NextResponse.json({ request })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Transition failed' }, { status: 400 })
  }
}
