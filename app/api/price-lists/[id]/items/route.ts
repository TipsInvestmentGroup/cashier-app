import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, MGMT_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

async function logChange(tx: any, list: { id: string; name: string }, productId: string, productName: string | null, oldPrice: number | null, newPrice: number, action: string, user: { userId: string; name?: string; email?: string }, reason?: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  await tx.priceChangeLog.create({ data: { priceListId: list.id, priceListName: list.name, productId, productName, oldPrice, newPrice, action, changedById: user.userId, changedByName: user.name || user.email || 'Unknown', reason: reason || null } })
}

/**
 * POST — upsert a single item (records price history).
 * Body: { productId, sellingPrice, reason? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can edit prices.' }, { status: 403 })
  const { id } = await params
  const list = await db.priceList.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!list) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const productId = String(body.productId || '')
  const price = roundMoney(Number(body.sellingPrice) || 0)
  if (!productId || price < 0) return NextResponse.json({ error: 'productId and a non-negative sellingPrice are required.' }, { status: 400 })
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { name: true } })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const existing = await db.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: id, productId } }, select: { sellingPrice: true } })
  await prisma.$transaction(async (tx) => {
    const tdb = tx as any // eslint-disable-line @typescript-eslint/no-explicit-any
    await tdb.priceListItem.upsert({
      where: { priceListId_productId: { priceListId: id, productId } },
      update: { sellingPrice: price },
      create: { priceListId: id, productId, sellingPrice: price },
    })
    await logChange(tdb, list, productId, product.name, existing?.sellingPrice ?? null, price, existing ? 'UPDATE' : 'CREATE', user, body.reason)
  })
  return NextResponse.json({ ok: true })
}

/**
 * PUT — bulk import items. Body: { items: [{ productId?, code?, sellingPrice }], mode?: 'merge'|'replace' }
 * Matches by productId or product code. Records history for each change.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can edit prices.' }, { status: 403 })
  const { id } = await params
  const list = await db.priceList.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!list) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  const rawItems: { productId?: string; code?: string; sellingPrice: number | string }[] = Array.isArray(body.items) ? body.items : []
  if (!rawItems.length) return NextResponse.json({ error: 'No items to import.' }, { status: 400 })

  const products = await prisma.product.findMany({ select: { id: true, code: true, name: true } })
  const byId = new Map(products.map((p) => [p.id, p]))
  const byCode = new Map(products.map((p) => [p.code.toUpperCase(), p]))
  const existing = await db.priceListItem.findMany({ where: { priceListId: id }, select: { productId: true, sellingPrice: true } }) as { productId: string; sellingPrice: number }[]
  const existingMap = new Map(existing.map((e) => [e.productId, e.sellingPrice]))

  let applied = 0, unmatched = 0
  const resolved: { productId: string; name: string; price: number }[] = []
  for (const r of rawItems) {
    const p = r.productId ? byId.get(r.productId) : (r.code ? byCode.get(String(r.code).toUpperCase()) : undefined)
    const price = roundMoney(Number(r.sellingPrice) || 0)
    if (!p || price < 0) { unmatched++; continue }
    resolved.push({ productId: p.id, name: p.name, price })
  }
  if (!resolved.length) return NextResponse.json({ error: 'No rows matched a known product (by id or code).' }, { status: 400 })

  await prisma.$transaction(async (tx) => {
    const tdb = tx as any // eslint-disable-line @typescript-eslint/no-explicit-any
    if (body.mode === 'replace') {
      await tdb.priceListItem.deleteMany({ where: { priceListId: id, productId: { notIn: resolved.map((r) => r.productId) } } })
    }
    for (const r of resolved) {
      const old = existingMap.get(r.productId) ?? null
      if (old === r.price) continue
      await tdb.priceListItem.upsert({ where: { priceListId_productId: { priceListId: id, productId: r.productId } }, update: { sellingPrice: r.price }, create: { priceListId: id, productId: r.productId, sellingPrice: r.price } })
      await logChange(tdb, list, r.productId, r.name, old, r.price, old === null ? 'CREATE' : 'UPDATE', user)
      applied++
    }
    await tdb.auditLog.create({ data: { userId: user.userId, action: 'IMPORT', entity: 'PriceList', entityId: id, details: `Bulk price import: ${applied} changed, ${unmatched} unmatched` } })
  })
  return NextResponse.json({ ok: true, applied, unmatched })
}

/** DELETE — remove one item (?productId=). Records history. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can edit prices.' }, { status: 403 })
  const { id } = await params
  const productId = new URL(req.url).searchParams.get('productId') || ''
  const list = await db.priceList.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!list) return NextResponse.json({ error: 'Price list not found' }, { status: 404 })
  const item = await db.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: id, productId } }, include: { product: { select: { name: true } } } })
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  await prisma.$transaction(async (tx) => {
    const tdb = tx as any // eslint-disable-line @typescript-eslint/no-explicit-any
    await tdb.priceListItem.delete({ where: { priceListId_productId: { priceListId: id, productId } } })
    await logChange(tdb, list, productId, item.product?.name || null, item.sellingPrice, 0, 'DELETE', user)
  })
  return NextResponse.json({ ok: true })
}
