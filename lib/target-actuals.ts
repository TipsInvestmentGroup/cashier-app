import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay } from 'date-fns'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

export interface Actuals {
  outlets: { id: string; name: string }[]
  byOutlet: Record<string, { collection: number; shisha: number; food: number }>
  byStaff: Record<string, { staffName: string; collection: number; shisha: number; food: number }[]>
}

/**
 * Net actuals for target tracking over a window:
 *  • Total Collection — daily collections.
 *  • Shisha (count) / Food (TZS) — uploaded SalesMetric, NET of shisha/food on
 *    signed bills (credit) and approved cancellations (classified by product
 *    category, name fallback). Staff grouped case-insensitively.
 */
export async function computeActuals(opts: { from: Date; to: Date; outletId?: string | null }): Promise<Actuals> {
  const range = { gte: startOfDay(opts.from), lte: endOfDay(opts.to) }
  const oWhere = opts.outletId ? { outletId: opts.outletId } : {}

  const [outlets, cols, metrics, products, bills, cancels] = await Promise.all([
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.dailyCollection.findMany({ where: { date: range, ...oWhere }, select: { outletId: true, staffName: true, total: true } }),
    db.salesMetric.findMany({ where: { date: range, ...oWhere }, select: { outletId: true, department: true, staffName: true, value: true } }),
    prisma.product.findMany({ select: { id: true, category: true, name: true } }),
    prisma.signedBill.findMany({ where: { date: range, ...oWhere, approvalStatus: { not: 'REJECTED' } }, select: { outletId: true, serviceStaff: true, items: { select: { productId: true, productName: true, quantity: true, amount: true } } } }),
    prisma.cancellation.findMany({ where: { date: range, ...(opts.outletId ? { outletId: opts.outletId } : {}), status: 'APPROVED' }, select: { outletId: true, productId: true, productName: true, quantity: true, amount: true, staffName: true, collection: { select: { staffName: true } } } }),
  ])

  const prodCat = new Map<string, string>()
  for (const p of products) prodCat.set(p.id, (p.category || '').toLowerCase())
  const classify = (productId?: string | null, productName?: string | null): 'shisha' | 'food' | null => {
    const hay = `${productId ? prodCat.get(productId) || '' : ''} ${productName || ''}`.toLowerCase()
    if (hay.includes('shisha')) return 'shisha'
    if (hay.includes('food')) return 'food'
    return null
  }

  const byOutlet: Record<string, { collection: number; shisha: number; food: number }> = {}
  const staffMaps: Record<string, Map<string, { staffName: string; collection: number; shisha: number; food: number }>> = {}
  const outletBucket = (id: string) => (byOutlet[id] ||= { collection: 0, shisha: 0, food: 0 })
  const staffBucket = (oid: string, name: string) => {
    const m = (staffMaps[oid] ||= new Map())
    const k = name.trim().toLowerCase()
    let s = m.get(k)
    if (!s) { s = { staffName: name.trim(), collection: 0, shisha: 0, food: 0 }; m.set(k, s) }
    return s
  }

  for (const c of cols) {
    if (!c.outletId) continue
    outletBucket(c.outletId).collection += c.total || 0
    if (c.staffName) staffBucket(c.outletId, c.staffName).collection += c.total || 0
  }
  for (const m of metrics as { outletId: string | null; department: string; staffName: string; value: number }[]) {
    if (!m.outletId) continue
    const key: 'shisha' | 'food' | null = m.department === 'SHISHA' ? 'shisha' : m.department === 'FOOD' ? 'food' : null
    if (!key) continue
    outletBucket(m.outletId)[key] += m.value || 0
    if (m.staffName) { const s = staffBucket(m.outletId, m.staffName); if (key === 'shisha') s.shisha += m.value || 0; else s.food += m.value || 0 }
  }
  for (const b of bills as { outletId: string | null; serviceStaff: string | null; items: { productId: string | null; productName: string | null; quantity: number; amount: number }[] }[]) {
    if (!b.outletId) continue
    for (const it of b.items) {
      const cls = classify(it.productId, it.productName)
      if (!cls) continue
      const amt = cls === 'shisha' ? it.quantity || 0 : it.amount || 0
      outletBucket(b.outletId)[cls] -= amt
      if (b.serviceStaff) { const s = staffBucket(b.outletId, b.serviceStaff); if (cls === 'shisha') s.shisha -= amt; else s.food -= amt }
    }
  }
  for (const c of cancels as { outletId: string | null; productId: string | null; productName: string | null; quantity: number; amount: number; staffName: string | null; collection: { staffName: string | null } | null }[]) {
    if (!c.outletId) continue
    const cls = classify(c.productId, c.productName)
    if (!cls) continue
    const amt = cls === 'shisha' ? c.quantity || 0 : c.amount || 0
    const staff = c.staffName || c.collection?.staffName || null
    outletBucket(c.outletId)[cls] -= amt
    if (staff) { const s = staffBucket(c.outletId, staff); if (cls === 'shisha') s.shisha -= amt; else s.food -= amt }
  }

  const flo = (n: number) => roundMoney(Math.max(0, n))
  const byStaff: Record<string, { staffName: string; collection: number; shisha: number; food: number }[]> = {}
  for (const [oid, m] of Object.entries(staffMaps)) {
    byStaff[oid] = [...m.values()].map((s) => ({ staffName: s.staffName, collection: flo(s.collection), shisha: flo(s.shisha), food: flo(s.food) }))
  }
  for (const id of Object.keys(byOutlet)) {
    byOutlet[id] = { collection: flo(byOutlet[id].collection), shisha: flo(byOutlet[id].shisha), food: flo(byOutlet[id].food) }
  }

  return { outlets, byOutlet, byStaff }
}
