import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { ensureDefaultStageConfig } from '@/lib/reconciliation-stage'

/** GET — list config rows, optionally filtered by scope/scopeId/stageKey. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await ensureDefaultStageConfig()
  const { searchParams } = new URL(req.url)
  const where: Record<string, unknown> = {}
  const scope = searchParams.get('scope')
  const scopeId = searchParams.get('scopeId')
  const stageKey = searchParams.get('stageKey')
  if (scope) where.scope = scope
  if (scopeId) where.scopeId = scopeId
  if (stageKey) where.stageKey = stageKey

  const configs = await prisma.reconciliationStageConfig.findMany({ where, orderBy: [{ stageKey: 'asc' }, { scope: 'asc' }] })
  return NextResponse.json({ configs })
}

/** POST — upsert one config row (owner/admin only). Body matches ReconciliationStageConfig fields. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!body.scope || !body.stageKey) return NextResponse.json({ error: 'scope and stageKey are required' }, { status: 400 })

  // Accepts either a raw array/object (JSON-encodes it) or an already-encoded
  // JSON string (passed through as-is) — the frontend round-trips a GET
  // response's already-stringified fields straight back into a later POST,
  // so re-stringifying a string here would double-encode it.
  const toJsonField = (v: unknown): string | null => {
    if (v == null) return null
    if (typeof v === 'string') return v
    return JSON.stringify(v)
  }

  const scopeId = body.scope === 'GLOBAL' ? null : body.scopeId
  const data = {
    startTime: body.startTime ?? null,
    endTime: body.endTime ?? null,
    closeMode: body.closeMode || 'MANUAL',
    requiredRoles: toJsonField(body.requiredRoles),
    validationStrictness: body.validationStrictness || 'BLOCK_ON_MISSING',
    graceMinutes: body.graceMinutes ?? 0,
    isEnabled: body.isEnabled ?? true,
    forceAutoClose: body.forceAutoClose ?? false,
    escalationRoles: toJsonField(body.escalationRoles),
    notifyChannels: toJsonField(body.notifyChannels) ?? '["IN_APP"]',
  }

  // scopeId is null for GLOBAL rows — NULL != NULL in the unique index, so a
  // compound-unique upsert can't target them (see
  // lib/reconciliation-stage.ts's ensureDefaultStageConfig for the same
  // issue/fix); findFirst + create/update instead.
  const existing = await prisma.reconciliationStageConfig.findFirst({ where: { scope: body.scope, scopeId, stageKey: body.stageKey } })
  const config = existing
    ? await prisma.reconciliationStageConfig.update({ where: { id: existing.id }, data })
    : await prisma.reconciliationStageConfig.create({ data: { scope: body.scope, scopeId, stageKey: body.stageKey, ...data } })
  return NextResponse.json({ ok: true, config })
}
