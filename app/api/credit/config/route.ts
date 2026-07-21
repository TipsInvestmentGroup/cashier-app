import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveCreditModuleConfig, setCreditModuleConfig, OVER_LIMIT_BEHAVIORS, type OverLimitBehavior } from '@/lib/credit-config'

/** GET — the resolved GLOBAL credit module config (ADMIN-only; Credit Settings). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const config = await resolveCreditModuleConfig(prisma, {})
  return NextResponse.json(config)
}

/** PUT — update the GLOBAL credit module config. Body: a partial config patch. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (body.allowOverLimit !== undefined && !OVER_LIMIT_BEHAVIORS.includes(body.allowOverLimit)) {
    return NextResponse.json({ error: `allowOverLimit must be one of ${OVER_LIMIT_BEHAVIORS.join(', ')}` }, { status: 400 })
  }
  if (body.moduleName !== undefined && !String(body.moduleName).trim()) {
    return NextResponse.json({ error: 'Module name cannot be empty' }, { status: 400 })
  }

  const row = await setCreditModuleConfig(prisma, 'GLOBAL', null, {
    moduleName: body.moduleName !== undefined ? String(body.moduleName).trim() : undefined,
    enabled: body.enabled,
    defaultCurrency: body.defaultCurrency,
    approvalRequiredDefault: body.approvalRequiredDefault,
    allowPartialPayments: body.allowPartialPayments,
    allowOverLimit: body.allowOverLimit as OverLimitBehavior | undefined,
    requireAttachmentsDefault: body.requireAttachmentsDefault,
    terminology: body.terminology,
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'CreditModuleConfig', entityId: row.id, details: 'Updated global credit module config' },
  })
  return NextResponse.json(await resolveCreditModuleConfig(prisma, {}))
}
