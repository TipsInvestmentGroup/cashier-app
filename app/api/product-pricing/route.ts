import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, CASHIER_ROLES, MGMT_ROLES } from '@/lib/auth'
import { getOrCreateScopedList } from '@/lib/pricing'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

async function logChange(tx: any, list: { id: string; name: string }, productId: string, productName: string | null, oldPrice: number | null, newPrice: number, action: string, user: { userId: string; name?: string; email?: string }, reason?: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  await tx.priceChangeLog.create({ data: { priceListId: list.id, priceListName: list.name, productId, productName, oldPrice, newPrice, action, changedById: user.userId, changedByName: user.name || user.email || 'Unknown', reason: reason || null } })
}

/**
 * Product-centric view of outlet/event pricing — the "Product Pricing"
 * module. Reads/writes through the same PriceList/PriceListItem engine as
 * /api/price-lists, but scoped to the single canonical OUTLET or EVENT list
 * per outlet/event (see getOrCreateScopedList), so a product can only ever
 * have one active price per outlet and one active price per event.
 *
 * GET — no params: overview grid (every product × every outlet/event override).
 * GET ?productId= : one product's base price + its outlet/event overrides.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const productId = new URL(req.url).searchParams.get('productId')

  // Every canonical outlet/event list (outletId xor eventId set, no customer group).
  const scopedLists = await db.priceList.findMany({
    where: { customerGroupId: null, OR: [{ outletId: { not: null } }, { eventId: { not: null } }] },
    select: {
      id: true, outletId: true, eventId: true,
      outlet: { select: { name: true } }, event: { select: { name: true } },
      items: { where: productId ? { productId } : undefined, select: { productId: true, sellingPrice: true } },
    },
  })

  if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true, code: true, sellingPrice: true } })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    const outletPrices = scopedLists.filter((l: { outletId: string | null }) => l.outletId).map((l: { id: string; outletId: string; outlet: { name: string } | null; items: { sellingPrice: number }[] }) => ({ priceListId: l.id, outletId: l.outletId, outletName: l.outlet?.name, sellingPrice: l.items[0]?.sellingPrice }))
      .filter((o: { sellingPrice: number | undefined }) => o.sellingPrice != null)
    const eventPrices = scopedLists.filter((l: { eventId: string | null }) => l.eventId).map((l: { id: string; eventId: string; event: { name: string } | null; items: { sellingPrice: number }[] }) => ({ priceListId: l.id, eventId: l.eventId, eventName: l.event?.name, sellingPrice: l.items[0]?.sellingPrice }))
      .filter((e: { sellingPrice: number | undefined }) => e.sellingPrice != null)
    return NextResponse.json({ product, outletPrices, eventPrices })
  }

  // Overview: products with any override, grouped.
  const products = await prisma.product.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, sellingPrice: true } })
  const byProduct = new Map<string, { outletPrices: unknown[]; eventPrices: unknown[] }>()
  for (const l of scopedLists as { outletId: string | null; eventId: string | null; outlet: { name: string } | null; event: { name: string } | null; items: { productId: string; sellingPrice: number }[] }[]) {
    for (const it of l.items) {
      const entry = byProduct.get(it.productId) || { outletPrices: [], eventPrices: [] }
      if (l.outletId) entry.outletPrices.push({ outletId: l.outletId, outletName: l.outlet?.name, sellingPrice: it.sellingPrice })
      else if (l.eventId) entry.eventPrices.push({ eventId: l.eventId, eventName: l.event?.name, sellingPrice: it.sellingPrice })
      byProduct.set(it.productId, entry)
    }
  }
  const rows = products.map((p) => ({ ...p, ...(byProduct.get(p.id) || { outletPrices: [], eventPrices: [] }) }))
  return NextResponse.json({ rows })
}

/**
 * POST — set (create/update) one product's price for one outlet or event.
 * Body: { productId, scope: 'OUTLET'|'EVENT', refId, sellingPrice, reason? }
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can edit prices.' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const productId = String(body.productId || '')
  const scope = body.scope === 'EVENT' ? 'EVENT' : body.scope === 'OUTLET' ? 'OUTLET' : null
  const refId = String(body.refId || '')
  const price = roundMoney(Number(body.sellingPrice) || 0)
  if (!productId || !scope || !refId || price < 0) return NextResponse.json({ error: 'productId, scope, refId and a non-negative sellingPrice are required.' }, { status: 400 })

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  if (scope === 'OUTLET' && !(await prisma.outlet.findUnique({ where: { id: refId }, select: { id: true } }))) return NextResponse.json({ error: 'Outlet not found' }, { status: 404 })
  if (scope === 'EVENT' && !(await db.event.findUnique({ where: { id: refId }, select: { id: true } }))) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const list = await getOrCreateScopedList(scope, refId, { userId: user.userId, userName: user.name || user.email || 'Unknown' })
  const existing = await db.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: list.id, productId } }, select: { sellingPrice: true } })
  await prisma.$transaction(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    await tx.priceListItem.upsert({
      where: { priceListId_productId: { priceListId: list.id, productId } },
      update: { sellingPrice: price },
      create: { priceListId: list.id, productId, sellingPrice: price },
    })
    await logChange(tx, list, productId, product.name, existing?.sellingPrice ?? null, price, existing ? 'UPDATE' : 'CREATE', user, body.reason)
  })
  return NextResponse.json({ ok: true })
}

/**
 * DELETE — remove a product's outlet/event override (falls back to the
 * default/base price). Query: ?productId=&scope=OUTLET|EVENT&refId=
 */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can edit prices.' }, { status: 403 })
  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('productId') || ''
  const scope = searchParams.get('scope') === 'EVENT' ? 'EVENT' : 'OUTLET'
  const refId = searchParams.get('refId') || ''
  if (!productId || !refId) return NextResponse.json({ error: 'productId and refId are required.' }, { status: 400 })

  const where = scope === 'OUTLET' ? { outletId: refId, eventId: null, customerGroupId: null } : { eventId: refId, outletId: null, customerGroupId: null }
  const list = await db.priceList.findFirst({ where, select: { id: true, name: true } })
  if (!list) return NextResponse.json({ error: 'No price list for that scope.' }, { status: 404 })
  const item = await db.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: list.id, productId } }, include: { product: { select: { name: true } } } })
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  await prisma.$transaction(async (tx: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    await tx.priceListItem.delete({ where: { priceListId_productId: { priceListId: list.id, productId } } })
    await logChange(tx, list, productId, item.product?.name || null, item.sellingPrice, 0, 'DELETE', user)
  })
  return NextResponse.json({ ok: true })
}
