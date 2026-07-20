import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'

const ALLOWED = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** Recent audit-log entries (supervisors only), with optional entity/action filter. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const entity = searchParams.get('entity')
  const action = searchParams.get('action')
  const entityId = searchParams.get('entityId')

  const where: Record<string, unknown> = {}
  if (entity) where.entity = entity
  if (action) where.action = action
  if (entityId) where.entityId = entityId

  const logs = await prisma.auditLog.findMany({
    where,
    include: { user: { select: { name: true, role: true } } },
    orderBy: { createdAt: 'desc' },
    take: 300,
  })

  // Distinct values for the filter dropdowns.
  const [entities, actions] = await Promise.all([
    prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
  ])

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id, createdAt: l.createdAt, action: l.action, entity: l.entity,
      entityId: l.entityId, details: l.details, user: l.user?.name || '—', role: l.user?.role || '',
    })),
    entities: entities.map((e) => e.entity),
    actions: actions.map((a) => a.action),
  })
}
