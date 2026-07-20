import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { ensureDefaultRequirements } from '@/lib/reconciliation-checks'

/** GET — list the plugin-style required-check registry, optionally filtered. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await ensureDefaultRequirements()
  const { searchParams } = new URL(req.url)
  const where: Record<string, unknown> = {}
  const stageKey = searchParams.get('stageKey')
  if (stageKey) where.stageKey = stageKey

  const requirements = await prisma.reconciliationRequirement.findMany({ where, orderBy: [{ stageKey: 'asc' }, { sortOrder: 'asc' }] })
  return NextResponse.json({ requirements })
}

/** POST — add/update a required-check row for a scope+stageKey+checkType. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!body.scope || !body.stageKey || !body.checkType) {
    return NextResponse.json({ error: 'scope, stageKey, and checkType are required' }, { status: 400 })
  }
  const scopeId = body.scope === 'GLOBAL' ? null : body.scopeId

  // scopeId is null for GLOBAL rows — NULL != NULL in the unique index, so a
  // compound-unique upsert can't target them; findFirst + create/update
  // instead (same issue/fix as reconciliation-stage-config's POST).
  const data = { isRequired: body.isRequired ?? true, sortOrder: body.sortOrder ?? 0 }
  const existing = await prisma.reconciliationRequirement.findFirst({ where: { scope: body.scope, scopeId, stageKey: body.stageKey, checkType: body.checkType } })
  const requirement = existing
    ? await prisma.reconciliationRequirement.update({ where: { id: existing.id }, data })
    : await prisma.reconciliationRequirement.create({ data: { scope: body.scope, scopeId, stageKey: body.stageKey, checkType: body.checkType, ...data } })
  return NextResponse.json({ ok: true, requirement })
}
