import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'

/** GET — list unlock requests (queue for approvers). Filters: status (default PENDING), outletId. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.APPROVE_RECONCILIATION_UNLOCK))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)
  if (outletId === NO_OUTLET) return NextResponse.json({ requests: [] })

  const status = searchParams.get('status') || 'PENDING'
  const requests = await prisma.reconciliationStageUnlockRequest.findMany({
    where: {
      status,
      stage: outletId ? { outletId } : undefined,
    },
    include: { stage: { include: { outlet: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json({ requests })
}
