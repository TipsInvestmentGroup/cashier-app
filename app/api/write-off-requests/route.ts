import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, WRITE_OFF_RESOURCES } from '@/lib/rbac'
import { tenantCompanyId, outletInCompany } from '@/lib/tenant'
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

  const companyId = await tenantCompanyId(user, searchParams.get('companyId'))
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

  const companyId = await tenantCompanyId(user, body.companyId)
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })
  if (outletId && !(await outletInCompany(prisma, outletId, companyId))) {
    return NextResponse.json({ error: 'Outlet does not belong to your company' }, { status: 400 })
  }
  if (body.reconciliationStageId) {
    const stage = await prisma.reconciliationStage.findUnique({ where: { id: body.reconciliationStageId }, select: { companyId: true } })
    if (!stage || stage.companyId !== companyId) {
      return NextResponse.json({ error: 'Reconciliation stage does not belong to your company' }, { status: 400 })
    }
  }
  // The source record (a recon / excess row) must sit in one of the caller's outlets.
  let sourceOutletId: string | null = null
  if (body.sourceModel === 'BankRecon') {
    sourceOutletId = (await prisma.bankRecon.findUnique({ where: { id: body.sourceId }, select: { outletId: true } }))?.outletId ?? null
  } else if (body.sourceModel === 'CashRecon') {
    sourceOutletId = (await prisma.cashRecon.findUnique({ where: { id: body.sourceId }, select: { outletId: true } }))?.outletId ?? null
  } else if (body.sourceModel === 'CashReconExcess') {
    sourceOutletId = (await prisma.cashReconExcess.findUnique({ where: { id: body.sourceId }, select: { cashRecon: { select: { outletId: true } } } }))?.cashRecon.outletId ?? null
  } else if (body.sourceModel === 'CollectionExcess') {
    sourceOutletId = (await prisma.collectionExcess.findUnique({ where: { id: body.sourceId }, select: { collection: { select: { outletId: true } } } }))?.collection.outletId ?? null
  }
  if (sourceOutletId && !(await outletInCompany(prisma, sourceOutletId, companyId))) {
    return NextResponse.json({ error: 'Source record does not belong to your company' }, { status: 400 })
  }

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
