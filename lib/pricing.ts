// Configurable Price List Engine — the single source of selling prices across
// POS, Sales Import, Finance, Reports and BI.
//
// One product, many prices. The Product master's sellingPrice is only a
// last-resort fallback during the safe phased cutover; authoritative prices come
// from PriceList/PriceListItem. Resolution priority (Event > Outlet > Customer
// Group > Default) is configurable via the Setting key PRICE_RESOLUTION_ORDER —
// nothing here is hardcoded to specific outlets, events or prices.

import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

export const PRICE_ORDER_KEY = 'PRICE_RESOLUTION_ORDER'
export type PriceScope = 'EVENT' | 'OUTLET' | 'CUSTOMER_GROUP' | 'DEFAULT'
export const DEFAULT_PRICE_ORDER: PriceScope[] = ['EVENT', 'OUTLET', 'CUSTOMER_GROUP', 'DEFAULT']
const VALID_SCOPES: PriceScope[] = ['EVENT', 'OUTLET', 'CUSTOMER_GROUP', 'DEFAULT']

export interface PriceContext {
  outletId?: string | null
  eventId?: string | null
  customerGroupId?: string | null
  date?: Date
}
export interface ResolvedPrice {
  price: number
  source: PriceScope | 'PRODUCT_FALLBACK'
  priceListId: string | null
  priceListName: string | null
  currency: string
}

interface PriceListLite {
  id: string; name: string; currency: string; priority: number; isDefault: boolean
  outletId: string | null; eventId: string | null; customerGroupId: string | null
  effectiveFrom: Date | null; createdAt: Date
  items: { productId: string; sellingPrice: number }[]
}

/** Configurable resolution order (Setting-backed, default Event>Outlet>Group>Default). */
export async function getPriceOrder(): Promise<PriceScope[]> {
  const row = await prisma.setting.findUnique({ where: { key: PRICE_ORDER_KEY } })
  if (!row?.value) return DEFAULT_PRICE_ORDER
  const parsed = row.value.split(',').map((s) => s.trim().toUpperCase()).filter((s): s is PriceScope => (VALID_SCOPES as string[]).includes(s))
  // Always ensure DEFAULT is present as the final fallback tier.
  if (!parsed.includes('DEFAULT')) parsed.push('DEFAULT')
  return parsed.length ? parsed : DEFAULT_PRICE_ORDER
}

export async function setPriceOrder(order: PriceScope[]): Promise<void> {
  const clean = order.filter((s) => VALID_SCOPES.includes(s))
  if (!clean.includes('DEFAULT')) clean.push('DEFAULT')
  await prisma.setting.upsert({ where: { key: PRICE_ORDER_KEY }, update: { value: clean.join(',') }, create: { key: PRICE_ORDER_KEY, value: clean.join(',') } })
}

/** The scope class a list belongs to, per the configured order (its strongest set dimension). */
function classOf(pl: PriceListLite, order: PriceScope[]): PriceScope | null {
  for (const s of order) {
    if (s === 'EVENT' && pl.eventId) return 'EVENT'
    if (s === 'OUTLET' && pl.outletId) return 'OUTLET'
    if (s === 'CUSTOMER_GROUP' && pl.customerGroupId) return 'CUSTOMER_GROUP'
    if (s === 'DEFAULT' && !pl.eventId && !pl.outletId && !pl.customerGroupId) return 'DEFAULT'
  }
  return null
}

/**
 * Resolve expected prices for many products in one context. Efficient for POS
 * menus and Sales Import batches. Returns a Map productId -> ResolvedPrice;
 * products with no matching list fall back to Product.sellingPrice.
 */
export async function resolvePrices(productIds: string[], ctx: PriceContext): Promise<Map<string, ResolvedPrice>> {
  const ids = [...new Set(productIds.filter(Boolean))]
  const out = new Map<string, ResolvedPrice>()
  if (!ids.length) return out
  const date = ctx.date || new Date()
  const order = await getPriceOrder()
  const rank = (c: PriceScope) => { const i = order.indexOf(c); return i < 0 ? 99 : i }

  // Candidate lists: ACTIVE, effective now, every set scope field matches the
  // context (null scope field = wildcard), and containing at least one product.
  const lists = await db.priceList.findMany({
    where: {
      status: 'ACTIVE',
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: date } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
        { OR: [{ outletId: null }, ...(ctx.outletId ? [{ outletId: ctx.outletId }] : [])] },
        { OR: [{ eventId: null }, ...(ctx.eventId ? [{ eventId: ctx.eventId }] : [])] },
        { OR: [{ customerGroupId: null }, ...(ctx.customerGroupId ? [{ customerGroupId: ctx.customerGroupId }] : [])] },
      ],
      items: { some: { productId: { in: ids } } },
    },
    select: {
      id: true, name: true, currency: true, priority: true, isDefault: true,
      outletId: true, eventId: true, customerGroupId: true, effectiveFrom: true, createdAt: true,
      items: { where: { productId: { in: ids } }, select: { productId: true, sellingPrice: true } },
    },
  }) as PriceListLite[]

  // Per product, pick the winning list: best scope class, then higher priority,
  // then most recent effectiveFrom/createdAt.
  const byProduct = new Map<string, { pl: PriceListLite; cls: PriceScope; price: number }[]>()
  for (const pl of lists) {
    const cls = classOf(pl, order)
    if (!cls) continue
    for (const it of pl.items) {
      const arr = byProduct.get(it.productId) || []
      arr.push({ pl, cls, price: it.sellingPrice })
      byProduct.set(it.productId, arr)
    }
  }
  for (const [pid, cands] of byProduct) {
    cands.sort((a, b) => {
      if (rank(a.cls) !== rank(b.cls)) return rank(a.cls) - rank(b.cls)
      if (a.pl.priority !== b.pl.priority) return b.pl.priority - a.pl.priority
      const af = (a.pl.effectiveFrom || a.pl.createdAt).getTime(), bf = (b.pl.effectiveFrom || b.pl.createdAt).getTime()
      return bf - af
    })
    const w = cands[0]
    out.set(pid, { price: roundMoney(w.price), source: w.cls, priceListId: w.pl.id, priceListName: w.pl.name, currency: w.pl.currency })
  }

  // Fallback to Product.sellingPrice for anything unresolved.
  const missing = ids.filter((id) => !out.has(id))
  if (missing.length) {
    const products = await prisma.product.findMany({ where: { id: { in: missing } }, select: { id: true, sellingPrice: true } })
    for (const p of products as { id: string; sellingPrice: number }[]) {
      out.set(p.id, { price: roundMoney(p.sellingPrice || 0), source: 'PRODUCT_FALLBACK', priceListId: null, priceListName: null, currency: 'TZS' })
    }
  }
  return out
}

/** Resolve one product's expected price. */
export async function resolvePrice(productId: string, ctx: PriceContext): Promise<ResolvedPrice | null> {
  if (!productId) return null
  const m = await resolvePrices([productId], ctx)
  return m.get(productId) || null
}

// ─── Promotions (applied AFTER the selling price is resolved) ─────────────────

export interface CartLine { productId: string; categoryId?: string | null; qty: number; unitPrice: number }
export interface AppliedPromo { promotionId: string; name: string; type: string; discount: number; note?: string }

/**
 * Compute promotion discounts for a set of priced cart lines. Percentage/Fixed/
 * BuyXGetY apply per matching line; Bundle applies across the cart. Returns the
 * per-line discounts and the total. Never mutates prices — promotions are a
 * layer on top of resolved prices.
 */
export async function computePromotions(lines: CartLine[], ctx: PriceContext): Promise<{ lineDiscounts: number[]; totalDiscount: number; applied: AppliedPromo[] }> {
  const lineDiscounts = new Array(lines.length).fill(0)
  const applied: AppliedPromo[] = []
  if (!lines.length) return { lineDiscounts, totalDiscount: 0, applied }
  const date = ctx.date || new Date()

  const promos = await db.promotion.findMany({
    where: {
      status: 'ACTIVE',
      AND: [
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: date } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
        { OR: [{ outletId: null }, ...(ctx.outletId ? [{ outletId: ctx.outletId }] : [])] },
        { OR: [{ eventId: null }, ...(ctx.eventId ? [{ eventId: ctx.eventId }] : [])] },
        { OR: [{ customerGroupId: null }, ...(ctx.customerGroupId ? [{ customerGroupId: ctx.customerGroupId }] : [])] },
      ],
    },
    orderBy: { priority: 'desc' },
  }) as {
    id: string; name: string; type: string; value: number; productId: string | null; categoryId: string | null
    buyQty: number | null; getQty: number | null; bundleConfig: string | null; bundlePrice: number | null
  }[]

  const matchesLine = (p: { productId: string | null; categoryId: string | null }, l: CartLine) =>
    (!p.productId && !p.categoryId) || (p.productId && p.productId === l.productId) || (p.categoryId && p.categoryId === l.categoryId)

  for (const p of promos) {
    if (p.type === 'PERCENTAGE') {
      lines.forEach((l, i) => { if (matchesLine(p, l)) { const d = roundMoney(l.unitPrice * l.qty * (p.value / 100)); lineDiscounts[i] += d; if (d > 0) applied.push({ promotionId: p.id, name: p.name, type: p.type, discount: d, note: `${p.value}% off` }) } })
    } else if (p.type === 'FIXED') {
      lines.forEach((l, i) => { if (matchesLine(p, l)) { const d = roundMoney(Math.min(p.value, l.unitPrice * l.qty)); lineDiscounts[i] += d; if (d > 0) applied.push({ promotionId: p.id, name: p.name, type: p.type, discount: d }) } })
    } else if (p.type === 'BUY_X_GET_Y' && p.buyQty && p.getQty) {
      const cycle = p.buyQty + p.getQty
      lines.forEach((l, i) => { if (matchesLine(p, l) && l.qty >= cycle) { const free = Math.floor(l.qty / cycle) * p.getQty!; const d = roundMoney(free * l.unitPrice); lineDiscounts[i] += d; if (d > 0) applied.push({ promotionId: p.id, name: p.name, type: p.type, discount: d, note: `${free} free` }) } })
    } else if (p.type === 'BUNDLE' && p.bundleConfig && p.bundlePrice != null) {
      try {
        const cfg = JSON.parse(p.bundleConfig) as { productId: string; qty: number }[]
        const times = Math.min(...cfg.map((c) => { const l = lines.find((x) => x.productId === c.productId); return l ? Math.floor(l.qty / c.qty) : 0 }))
        if (times > 0) {
          const normal = cfg.reduce((s, c) => { const l = lines.find((x) => x.productId === c.productId); return s + (l ? l.unitPrice * c.qty : 0) }, 0)
          const d = roundMoney(Math.max(0, (normal - p.bundlePrice) * times))
          if (d > 0) {
            // Attribute bundle discount to the first bundle line found.
            const idx = lines.findIndex((x) => x.productId === cfg[0].productId)
            if (idx >= 0) lineDiscounts[idx] += d
            applied.push({ promotionId: p.id, name: p.name, type: p.type, discount: d, note: `bundle ×${times}` })
          }
        }
      } catch { /* malformed bundle config — skip */ }
    }
  }

  const totalDiscount = roundMoney(lineDiscounts.reduce((s, d) => s + d, 0))
  return { lineDiscounts, totalDiscount, applied }
}

/**
 * Ensure a Default price list exists and (optionally) backfill its items from
 * each active Product's legacy sellingPrice. Idempotent. Used by the safe phased
 * cutover so the Default tier becomes editable in the UI.
 */
export async function ensureDefaultPriceList(actor?: { userId?: string; userName?: string }): Promise<{ id: string; seeded: number }> {
  let def = await db.priceList.findFirst({ where: { isDefault: true } })
  if (!def) {
    def = await db.priceList.create({ data: { name: 'Default Price List', isDefault: true, status: 'ACTIVE', currency: 'TZS', createdById: actor?.userId, createdByName: actor?.userName } })
  }
  const products = await prisma.product.findMany({ where: { isActive: true }, select: { id: true, name: true, sellingPrice: true } })
  const existing = await db.priceListItem.findMany({ where: { priceListId: def.id }, select: { productId: true } })
  const have = new Set((existing as { productId: string }[]).map((e) => e.productId))
  const toAdd = (products as { id: string; name: string; sellingPrice: number }[]).filter((p) => !have.has(p.id))
  if (toAdd.length) {
    await db.priceListItem.createMany({ data: toAdd.map((p) => ({ priceListId: def.id, productId: p.id, sellingPrice: p.sellingPrice || 0 })) })
  }
  return { id: def.id, seeded: toAdd.length }
}
