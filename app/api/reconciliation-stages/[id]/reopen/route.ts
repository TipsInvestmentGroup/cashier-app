import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { tenantCompanyId } from '@/lib/tenant'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { reopenStage } from '@/lib/reconciliation-stage'

/** POST — direct reopen (management only, no unlock-request needed). Body: { reason }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.UNLOCK_RECONCILIATION_STAGE))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!body.reason) return NextResponse.json({ error: 'A reason is required to reopen a closed stage' }, { status: 400 })

  const callerCompany = await tenantCompanyId(user)
  const owned = await prisma.reconciliationStage.findUnique({ where: { id }, select: { companyId: true } })
  if (!callerCompany || !owned || owned.companyId !== callerCompany) return NextResponse.json({ error: 'Stage not found' }, { status: 404 })

  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }
  try {
    const stage = await reopenStage({ stageId: id, actor, reason: body.reason })
    return NextResponse.json({ ok: true, stage })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to reopen stage' }, { status: 400 })
  }
}
