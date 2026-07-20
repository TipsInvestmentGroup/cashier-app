import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { getOrCreateStage, openStage, checkGraceAndEscalateMany, type StageKey } from '@/lib/reconciliation-stage'

/** GET — Reconciliation Stage dashboard list. Filters: companyId, outletId, stageKey, status, from, to. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.VIEW_RECONCILIATION_STAGES))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)
  if (outletId === NO_OUTLET) return NextResponse.json({ stages: [] })

  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ stages: [] })

  const stageKey = searchParams.get('stageKey')
  const status = searchParams.get('status')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  await checkGraceAndEscalateMany({ companyId })

  const where: Record<string, unknown> = { companyId }
  if (outletId) where.outletId = outletId
  if (stageKey) where.stageKey = stageKey
  if (status) where.status = status
  if (from || to) where.date = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) }

  const stages = await prisma.reconciliationStage.findMany({
    where,
    include: { outlet: { select: { id: true, name: true } }, checkResults: true },
    orderBy: { date: 'desc' },
    take: 500,
  })

  return NextResponse.json({
    stages: stages.map((s) => ({
      id: s.id,
      companyId: s.companyId,
      outlet: s.outlet,
      date: s.date,
      stageKey: s.stageKey,
      status: s.status,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      closedByName: s.closedByName,
      result: s.result,
      resultDetail: s.resultDetail ? JSON.parse(s.resultDetail) : null,
      escalatedAt: s.escalatedAt,
      checkResults: s.checkResults.map((c) => ({ checkType: c.checkType, status: c.status, detail: c.detail ? JSON.parse(c.detail) : null })),
    })),
  })
}

/** POST — get-or-open a stage instance for (companyId|outletId, date, stageKey). Body: { companyId?, outletId?, date, stageKey }. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (!body.date || !body.stageKey) return NextResponse.json({ error: 'date and stageKey are required' }, { status: 400 })

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
    const stage = await openStage({ companyId, outletId, date: new Date(body.date), stageKey: body.stageKey as StageKey, actor })
    return NextResponse.json({ stage })
  } catch (err) {
    const stage = await getOrCreateStage({ companyId, outletId, date: new Date(body.date), stageKey: body.stageKey as StageKey })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to open stage', stage }, { status: 400 })
  }
}
