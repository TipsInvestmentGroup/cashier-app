import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, CASHIER_ROLES, MGMT_ROLES } from '@/lib/auth'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

const parseD = (s: unknown) => { if (!s) return null; const d = new Date(String(s)); return isNaN(d.getTime()) ? null : d }

/** GET — list all price lists with scope names + item counts. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await db.priceList.findMany({
    orderBy: [{ isDefault: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    include: {
      outlet: { select: { name: true } },
      event: { select: { name: true } },
      customerGroup: { select: { name: true } },
      _count: { select: { items: true } },
    },
  })
  return NextResponse.json({ rows })
}

/** POST — create a price list header. Body: { name, description?, outletId?, eventId?, customerGroupId?, currency?, effectiveFrom?, effectiveTo?, priority?, status? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can create price lists.' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Price list name is required.' }, { status: 400 })

  const status = ['ACTIVE', 'INACTIVE', 'PENDING_APPROVAL'].includes(body.status) ? body.status : 'ACTIVE'
  const created = await db.priceList.create({
    data: {
      name: name.slice(0, 200),
      description: body.description ? String(body.description).slice(0, 500) : null,
      outletId: body.outletId || null,
      eventId: body.eventId || null,
      customerGroupId: body.customerGroupId || null,
      currency: (body.currency || 'TZS').toString().slice(0, 8),
      effectiveFrom: parseD(body.effectiveFrom),
      effectiveTo: parseD(body.effectiveTo),
      priority: Number.isFinite(+body.priority) ? Math.trunc(+body.priority) : 0,
      status,
      createdById: user.userId,
      createdByName: user.name || user.email || 'Unknown',
    },
    select: { id: true },
  })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'PriceList', entityId: created.id, details: `Created price list "${name}"` } })
  return NextResponse.json({ ok: true, id: created.id })
}
