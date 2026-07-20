import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { setReminderPolicy } from '@/lib/reconciliation-reminders'
import type { StageKey } from '@/lib/reconciliation-stage'

/** GET — list reminder/escalation cadence config rows, optionally filtered. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const where: Record<string, unknown> = {}
  const scope = searchParams.get('scope')
  const scopeId = searchParams.get('scopeId')
  if (scope) where.scope = scope
  if (scopeId) where.scopeId = scopeId

  const policies = await prisma.reconciliationReminderPolicy.findMany({ where, orderBy: [{ scope: 'asc' }, { stageKey: 'asc' }] })
  return NextResponse.json({ policies })
}

/** POST — upsert one cadence override. Body: { scope, scopeId?, stageKey?, firstReminderMinutes, secondReminderMinutes, escalationAtEndOfWindow, reminderAnchor?, generateExceptionReport? }. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!body.scope) return NextResponse.json({ error: 'scope is required' }, { status: 400 })

  const policy = await setReminderPolicy({
    scope: body.scope,
    scopeId: body.scope === 'GLOBAL' ? null : body.scopeId ?? null,
    stageKey: (body.stageKey as StageKey) ?? null,
    reminderAnchor: body.reminderAnchor,
    firstReminderMinutes: body.firstReminderMinutes,
    secondReminderMinutes: body.secondReminderMinutes,
    escalationAtEndOfWindow: body.escalationAtEndOfWindow,
    generateExceptionReport: body.generateExceptionReport,
  })
  return NextResponse.json({ ok: true, policy })
}
