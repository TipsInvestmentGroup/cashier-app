import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { loadActiveTargets } from '@/lib/sales-targets'
import { TARGET_SCOPES } from '@/lib/targets'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** Active sales targets (with outlet names). Any authed user may read.
 *  ?all=1 (Admin only) also returns deactivated targets, for the manage UI. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const wantAll = req.nextUrl.searchParams.get('all') === '1' && user.role === 'ADMIN'
  if (!wantAll) return NextResponse.json(await loadActiveTargets())

  await loadActiveTargets() // ensures first-run seed happened
  const rows = await db.salesTarget.findMany({
    include: { outlet: { select: { name: true } } },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return NextResponse.json(rows.map((r: { id: string; outletId: string; outlet: { name: string }; scope: string; department: string; unit: string; unitLabel: string | null; weeklyTarget: number; isActive: boolean }) => ({
    id: r.id, outletId: r.outletId, outletName: r.outlet.name, scope: r.scope,
    department: r.department, unit: r.unit, unitLabel: r.unitLabel,
    weeklyTarget: r.weeklyTarget, isActive: r.isActive,
  })))
}

/** Create a target — Admin only. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Only an Admin can manage targets' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { outletId, scope, department, unit, unitLabel, weeklyTarget } = body
  if (!outletId) return NextResponse.json({ error: 'Outlet is required' }, { status: 400 })
  if (!TARGET_SCOPES.includes(scope)) return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  if (!department || !String(department).trim()) return NextResponse.json({ error: 'Department is required' }, { status: 400 })
  if (unit !== 'TZS' && unit !== 'COUNT') return NextResponse.json({ error: 'Invalid unit' }, { status: 400 })
  const weekly = Number(weeklyTarget)
  if (!Number.isFinite(weekly) || weekly <= 0) return NextResponse.json({ error: 'Weekly target must be > 0' }, { status: 400 })

  const outlet = await prisma.outlet.findUnique({ where: { id: outletId } })
  if (!outlet) return NextResponse.json({ error: 'Outlet not found' }, { status: 404 })

  const maxSort = await db.salesTarget.aggregate({ _max: { sortOrder: true } })
  const item = await db.salesTarget.create({
    data: {
      outletId, scope, department: String(department).trim(), unit,
      unitLabel: unit === 'COUNT' ? (String(unitLabel || '').trim() || null) : null,
      weeklyTarget: weekly, sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'SalesTarget', entityId: item.id, details: `Target: ${outlet.name} · ${scope} · ${department} = ${weekly}/wk` } })
  return NextResponse.json(item, { status: 201 })
}
