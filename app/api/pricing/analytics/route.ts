import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, readOutletScope, CASHIER_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * GET — pricing BI over approved (imported, non-superseded) sales lines:
 * revenue, quantity, price variance (actual vs Price-List-Engine expected) and
 * margin (actual vs Product.buyingPrice), grouped by product / outlet / category
 * / price list. ?from&to&outletId
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const from = parseD(searchParams.get('from')) || startOfDay(new Date())
  const to = parseD(searchParams.get('to')) || new Date()
  const outletId = readOutletScope(user, searchParams.get('outletId'))

  const where: Record<string, unknown> = { import: { status: 'IMPORTED' }, superseded: false, date: { gte: startOfDay(from), lte: endOfDay(to) } }
  if (outletId) where.outletId = outletId

  const lines = await db.salesImportLine.findMany({
    where,
    select: { outletId: true, productId: true, productName: true, categoryName: true, qty: true, amount: true, unitPriceMaster: true, priceListId: true },
  }) as { outletId: string | null; productId: string | null; productName: string; categoryName: string | null; qty: number; amount: number; unitPriceMaster: number | null; priceListId: string | null }[]

  const [outlets, products, priceLists] = await Promise.all([
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.product.findMany({ select: { id: true, buyingPrice: true } }),
    db.priceList.findMany({ select: { id: true, name: true } }),
  ])
  const outletName = new Map(outlets.map((o) => [o.id, o.name]))
  const buying = new Map((products as { id: string; buyingPrice: number }[]).map((p) => [p.id, p.buyingPrice]))
  const listName = new Map((priceLists as { id: string; name: string }[]).map((l) => [l.id, l.name]))

  const mk = () => ({ qty: 0, revenue: 0, cost: 0, expected: 0, variance: 0 })
  type Bucket = ReturnType<typeof mk> & { key: string; name: string }
  const group = (map: Map<string, Bucket>, key: string, name: string, l: typeof lines[number], cost: number, expected: number) => {
    const b = map.get(key) || { key, name, ...mk() }
    b.qty += l.qty; b.revenue += l.amount; b.cost += cost; b.expected += expected; b.variance += l.amount - expected
    map.set(key, b)
  }
  const byProduct = new Map<string, Bucket>(), byOutlet = new Map<string, Bucket>(), byCategory = new Map<string, Bucket>(), byPriceList = new Map<string, Bucket>()
  let revenue = 0, qty = 0, cost = 0, expected = 0

  for (const l of lines) {
    const unitCost = l.productId ? (buying.get(l.productId) || 0) : 0
    const lineCost = unitCost * l.qty
    const lineExpected = l.unitPriceMaster != null ? l.unitPriceMaster * l.qty : l.amount // no expected → assume on-price
    revenue += l.amount; qty += l.qty; cost += lineCost; expected += lineExpected
    const pk = l.productId || `raw:${l.productName.trim().toLowerCase()}`
    group(byProduct, pk, l.productName || '(unnamed)', l, lineCost, lineExpected)
    if (l.outletId) group(byOutlet, l.outletId, outletName.get(l.outletId) || 'Outlet', l, lineCost, lineExpected)
    const ck = (l.categoryName || 'Uncategorized').toLowerCase()
    group(byCategory, ck, l.categoryName || 'Uncategorized', l, lineCost, lineExpected)
    const lk = l.priceListId || 'fallback'
    group(byPriceList, lk, l.priceListId ? (listName.get(l.priceListId) || 'Price list') : 'Product fallback', l, lineCost, lineExpected)
  }

  const finalize = (m: Map<string, Bucket>) => [...m.values()].map((b) => ({
    key: b.key, name: b.name, qty: roundMoney(b.qty), revenue: roundMoney(b.revenue),
    cost: roundMoney(b.cost), margin: roundMoney(b.revenue - b.cost),
    marginPct: b.revenue > 0 ? roundMoney(((b.revenue - b.cost) / b.revenue) * 100) : 0,
    variance: roundMoney(b.variance),
  })).sort((a, b) => b.revenue - a.revenue)

  return NextResponse.json({
    kpis: {
      revenue: roundMoney(revenue), qty: roundMoney(qty), cost: roundMoney(cost),
      margin: roundMoney(revenue - cost), marginPct: revenue > 0 ? roundMoney(((revenue - cost) / revenue) * 100) : 0,
      variance: roundMoney(revenue - expected), lines: lines.length,
    },
    byProduct: finalize(byProduct), byOutlet: finalize(byOutlet), byCategory: finalize(byCategory), byPriceList: finalize(byPriceList),
    outletOptions: outlets,
  })
}
