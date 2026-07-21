import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, CASHIER_ROLES, MGMT_ROLES } from '@/lib/auth'
import { getPriceOrder, setPriceOrder, ensureDefaultPriceList, DEFAULT_PRICE_ORDER, type PriceScope } from '@/lib/pricing'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** GET — the configurable resolution order + whether a Default list exists. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const order = await getPriceOrder()
  const hasDefault = !!(await db.priceList.findFirst({ where: { isDefault: true }, select: { id: true } }))
  return NextResponse.json({ order, options: DEFAULT_PRICE_ORDER, hasDefault })
}

/** PUT — set the resolution order. Body: { order: PriceScope[] } */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can change pricing config.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (!Array.isArray(body.order)) return NextResponse.json({ error: 'order[] required' }, { status: 400 })
  await setPriceOrder(body.order as PriceScope[])
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'PricingConfig', details: `Set price resolution order: ${body.order.join(' > ')}` } })
  return NextResponse.json({ ok: true, order: await getPriceOrder() })
}

/** POST — seed/refresh the Default price list from Product.sellingPrice. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can seed the Default price list.' }, { status: 403 })
  const res = await ensureDefaultPriceList({ userId: user.userId, userName: user.name || user.email || 'Unknown' })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'SEED', entity: 'PriceList', entityId: res.id, details: `Seeded Default price list (${res.seeded} products added)` } })
  return NextResponse.json({ ok: true, ...res })
}
