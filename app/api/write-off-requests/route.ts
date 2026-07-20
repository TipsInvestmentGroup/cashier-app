import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, WRITE_OFF_RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { requestWriteOff } from '@/lib/write-off'

/** GET — list write-off requests. Filters: companyId, outletId, status. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, WRITE_OFF_RESOURCES.VIEW_WRITE_OFFS))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)
  if (outletId === NO_OUTLET) return NextResponse.json({ writeOffRequests: [] })

  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ writeOffRequests: [] })

  const status = searchParams.get('status')
  const where: Record<string, unknown> = { companyId }
  if (outletId) where.outletId = outletId
  if (status) where.status = status

  const writeOffRequests = await prisma.writeOffRequest.findMany({ where, include: { auditLogs: { orderBy: { createdAt: 'desc' } } }, orderBy: { createdAt: 'desc' }, take: 500 })
  return NextResponse.json({ writeOffRequests })
}

/** POST — request a write-off (Cashier/Supervisor). Body: { outletId?, reconciliationStageId?, sourceModel, sourceId, expectedAmount, receivedAmount, reason, evidenceUrl? }. channelKey is derived server-side from sourceModel/sourceId, never taken from the client. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, WRITE_OFF_RESOURCES.REQUEST_WRITE_OFF))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!body.sourceModel || !body.sourceId || body.expectedAmount == null || body.receivedAmount == null || !body.reason) {
    return NextResponse.json({ error: 'sourceModel, sourceId, expectedAmount, receivedAmount, and reason are required' }, { status: 400 })
  }

  const outletId = body.outletId ? readOutletScope(user, body.outletId) : null
  if (outletId === NO_OUTLET) return NextResponse.json({ error: 'No outlet access' }, { status: 403 })

  let companyId = body.companyId as string | undefined
  if (!companyId && outletId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    companyId = outlet?.companyId || undefined
  }
  if (!companyId) companyId = (await resolveDefaultCompanyId(prisma)) || undefined
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })

  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }
  try {
    const request = await requestWriteOff({
      companyId,
      outletId,
      reconciliationStageId: body.reconciliationStageId ?? null,
      sourceModel: body.sourceModel,
      sourceId: body.sourceId,
      expectedAmount: Number(body.expectedAmount),
      receivedAmount: Number(body.receivedAmount),
      reason: body.reason,
      evidenceUrl: body.evidenceUrl ?? null,
      actor,
    })
    return NextResponse.json({ ok: true, request })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create write-off request' }, { status: 400 })
  }
}
