import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { REFERENCE_COMPONENT_TYPES } from '@/lib/bill-reference-defaults'

const CAN_MANAGE = ['ADMIN', 'DIRECTOR']

// DATE/BILL_TYPE_CODE/PERSON_CODE/SEQUENCE must always exist (toggleable via
// isEnabled, never removable) — mirrors the client's non-deletable set in
// app/bill-reference-settings/page.tsx. Enforced again here defense-in-depth
// in case a stale/tampered client ever sends one of these ids in deleteIds.
const CORE_TYPES = new Set(['DATE', 'BILL_TYPE_CODE', 'PERSON_CODE', 'SEQUENCE'])
const VALID_TYPES = new Set<string>(REFERENCE_COMPONENT_TYPES)

interface ComponentInput {
  id?: string
  type: string
  label: string
  order: number
  isEnabled: boolean
  staticValue?: string | null
}

/** Replace the full component list + order — ADMIN/DIRECTOR only. Body carries
 *  the FULL ordered array (ids may be new — a client-added optional component
 *  — or existing) plus an optional deleteIds[] for components removed
 *  entirely. Every type is unique per config (@@unique([configId, type])), so
 *  each row is upserted keyed on (configId, type) rather than on the client's
 *  id — this handles "new" and "existing" rows uniformly without needing to
 *  guess which ids are already persisted. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_MANAGE)) return NextResponse.json({ error: 'You are not authorized to change Bill Reference Settings' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const components: ComponentInput[] = Array.isArray(body.components) ? body.components : []
  const deleteIds: string[] = Array.isArray(body.deleteIds) ? body.deleteIds.filter((id: unknown) => typeof id === 'string') : []

  if (components.length === 0) {
    return NextResponse.json({ error: 'At least one component is required' }, { status: 400 })
  }
  for (const c of components) {
    if (!VALID_TYPES.has(c.type)) return NextResponse.json({ error: `Invalid component type "${c.type}"` }, { status: 400 })
    if (!c.label || !String(c.label).trim()) return NextResponse.json({ error: `Component "${c.type}" needs a label` }, { status: 400 })
  }
  const types = components.map((c) => c.type)
  if (new Set(types).size !== types.length) {
    return NextResponse.json({ error: 'Each component type may only appear once' }, { status: 400 })
  }

  const result = await prisma.$transaction(async (tx) => {
    // Ensure the singleton row exists (a client could in theory hit this
    // endpoint before ever GET-ing /api/bill-reference-config).
    await tx.billReferenceConfig.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } })

    if (deleteIds.length) {
      const toDelete = await tx.billReferenceComponent.findMany({ where: { id: { in: deleteIds }, configId: 'default' } })
      const safeDeleteIds = toDelete.filter((c) => !CORE_TYPES.has(c.type)).map((c) => c.id)
      if (safeDeleteIds.length) await tx.billReferenceComponent.deleteMany({ where: { id: { in: safeDeleteIds } } })
    }

    for (const c of components) {
      const label = String(c.label).trim()
      const staticValue = c.type === 'STATIC_TEXT' ? (c.staticValue ?? null) : null
      await tx.billReferenceComponent.upsert({
        where: { configId_type: { configId: 'default', type: c.type } },
        update: { label, order: Number(c.order) || 0, isEnabled: !!c.isEnabled, staticValue },
        create: { configId: 'default', type: c.type, label, order: Number(c.order) || 0, isEnabled: !!c.isEnabled, staticValue },
      })
    }

    return tx.billReferenceComponent.findMany({ where: { configId: 'default' }, orderBy: { order: 'asc' } })
  })

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'UPDATE',
      entity: 'BillReferenceComponent',
      entityId: 'default',
      details: `Updated Bill Reference component layout (${result.length} components${deleteIds.length ? `, removed ${deleteIds.length}` : ''})`,
    },
  })

  return NextResponse.json(result)
}
