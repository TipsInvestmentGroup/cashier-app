import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay } from 'date-fns'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cashiers only ever deal with their own outlet — never expose others.
  const where: Record<string, unknown> = { isActive: true }
  if (user.role === 'CASHIER') where.id = user.outletId || '__none__'

  const outlets = await prisma.outlet.findMany({
    where,
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(outlets)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, location } = await req.json()
  const outlet = await prisma.outlet.create({ data: { name, location } })
  return NextResponse.json(outlet, { status: 201 })
}

/**
 * PATCH — set an outlet's Transaction Ledger itemisation cut-over (ADMIN).
 * Body: { id, itemisedCollectionsFrom: 'YYYY-MM-DD' | null }. From that business
 * date on, channels with captureMode=TRANSACTIONS must be itemised; earlier days
 * stay as recorded ("not itemised").
 */
export async function PATCH(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const id = String(body.id || '')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  let cutover: Date | null = null
  if (body.itemisedCollectionsFrom) {
    cutover = startOfDay(new Date(body.itemisedCollectionsFrom))
    if (isNaN(cutover.getTime())) return NextResponse.json({ error: 'Invalid itemisedCollectionsFrom date' }, { status: 400 })
  }

  const before = await prisma.outlet.findUnique({ where: { id }, select: { itemisedCollectionsFrom: true, name: true } })
  if (!before) return NextResponse.json({ error: 'Outlet not found' }, { status: 404 })
  const outlet = await prisma.outlet.update({ where: { id }, data: { itemisedCollectionsFrom: cutover } })
  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'UPDATE', entity: 'Outlet', entityId: id,
      details: JSON.stringify({ changes: { itemisedCollectionsFrom: { from: before.itemisedCollectionsFrom?.toISOString() ?? null, to: cutover?.toISOString() ?? null } } }),
    },
  })
  return NextResponse.json(outlet)
}
