import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, readOutletScope, CASHIER_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid, format } from 'date-fns'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * GET — Business-intelligence roll-ups from imported sales, built ONLY from
 * lines whose parent SalesImport is IMPORTED (approved). Unapproved/rejected/
 * pending batches never affect analytics.
 * ?from=yyyy-MM-dd&to=yyyy-MM-dd&outletId=
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

  const where: Record<string, unknown> = {
    import: { status: 'IMPORTED' },
    superseded: false, // a re-imported day supersedes the prior batch's lines
    date: { gte: startOfDay(from), lte: endOfDay(to) },
  }
  if (outletId) where.outletId = outletId

  const lines = await db.salesImportLine.findMany({
    where,
    select: { date: true, outletId: true, staffName: true, productId: true, productName: true, categoryName: true, qty: true, amount: true, priceMismatch: true },
  }) as { date: Date; outletId: string | null; staffName: string; productId: string | null; productName: string; categoryName: string | null; qty: number; amount: number; priceMismatch: boolean }[]

  const outlets = await prisma.outlet.findMany({ select: { id: true, name: true } })
  const outletName = new Map(outlets.map((o) => [o.id, o.name]))

  // ── Accumulators ──
  const byProduct = new Map<string, { key: string; productId: string | null; name: string; category: string | null; qty: number; revenue: number; lines: number }>()
  const byCategory = new Map<string, { name: string; qty: number; revenue: number }>()
  const byStaff = new Map<string, { staffName: string; qty: number; revenue: number; products: Set<string> }>()
  const byOutlet = new Map<string, { outletId: string; name: string; qty: number; revenue: number }>()
  const byDay = new Map<string, { date: string; qty: number; revenue: number }>()
  let revenue = 0, qty = 0, priceMismatches = 0

  for (const l of lines) {
    const amt = l.amount || 0, q = l.qty || 0
    revenue += amt; qty += q
    if (l.priceMismatch) priceMismatches++

    const pk = l.productId || `raw:${l.productName.trim().toLowerCase()}`
    const p = byProduct.get(pk) || { key: pk, productId: l.productId, name: l.productName || '(unnamed)', category: l.categoryName, qty: 0, revenue: 0, lines: 0 }
    p.qty += q; p.revenue += amt; p.lines++; byProduct.set(pk, p)

    const ck = (l.categoryName || 'Uncategorized').trim()
    const c = byCategory.get(ck.toLowerCase()) || { name: ck, qty: 0, revenue: 0 }
    c.qty += q; c.revenue += amt; byCategory.set(ck.toLowerCase(), c)

    const sk = l.staffName.trim().toLowerCase()
    const s = byStaff.get(sk) || { staffName: l.staffName.trim(), qty: 0, revenue: 0, products: new Set<string>() }
    s.qty += q; s.revenue += amt; if (pk) s.products.add(pk); byStaff.set(sk, s)

    if (l.outletId) {
      const o = byOutlet.get(l.outletId) || { outletId: l.outletId, name: outletName.get(l.outletId) || 'Outlet', qty: 0, revenue: 0 }
      o.qty += q; o.revenue += amt; byOutlet.set(l.outletId, o)
    }

    const dk = format(startOfDay(l.date), 'yyyy-MM-dd')
    const d = byDay.get(dk) || { date: dk, qty: 0, revenue: 0 }
    d.qty += q; d.revenue += amt; byDay.set(dk, d)
  }

  const round = <T extends { qty: number; revenue: number }>(x: T) => ({ ...x, qty: roundMoney(x.qty), revenue: roundMoney(x.revenue) })
  const products = [...byProduct.values()].map(round).sort((a, b) => b.revenue - a.revenue)
  const staff = [...byStaff.values()].map((s) => ({ staffName: s.staffName, qty: roundMoney(s.qty), revenue: roundMoney(s.revenue), products: s.products.size })).sort((a, b) => b.revenue - a.revenue)
  const categories = [...byCategory.values()].map(round).sort((a, b) => b.revenue - a.revenue)
  const outletsRollup = [...byOutlet.values()].map(round).sort((a, b) => b.revenue - a.revenue)
  const trend = [...byDay.values()].map(round).sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({
    kpis: {
      revenue: roundMoney(revenue),
      qty: roundMoney(qty),
      lines: lines.length,
      products: byProduct.size,
      staff: byStaff.size,
      priceMismatches,
      avgLineValue: lines.length ? roundMoney(revenue / lines.length) : 0,
    },
    // Best/slow sellers are the top/bottom of `products` (client slices); full list returned for tables.
    products,
    bestSellers: products.slice(0, 10),
    slowSellers: [...products].filter((p) => p.revenue > 0).sort((a, b) => a.revenue - b.revenue).slice(0, 10),
    categories,
    staff,
    outlets: outletsRollup,
    trend,
    outletOptions: outlets,
  })
}
