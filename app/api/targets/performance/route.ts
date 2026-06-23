import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Actuals for target tracking over a window.
 *  • Total Collection — from daily collections (per outlet & per staff).
 *  • Shisha (count) / Food (TZS) — uploaded SalesMetric, then adjusted to NET by
 *    subtracting the shisha/food given on credit (signed bills) and approved
 *    cancellations, so achievement reflects real, realised sales.
 * Shisha vs Food is identified by the product category (name fallback).
 * Cashier-scoped to their own outlet.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const from = parseD(searchParams.get('from')) || new Date()
  const to = parseD(searchParams.get('to')) || from
  const range = { gte: startOfDay(from), lte: endOfDay(to) }
  const oWhere = outletId ? { outletId } : {}

  const [outlets, cols, metrics, products, bills, cancels] = await Promise.all([
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.dailyCollection.findMany({ where: { date: range, ...oWhere }, select: { outletId: true, staffName: true, total: true } }),
    db.salesMetric.findMany({ where: { date: range, ...oWhere }, select: { outletId: true, department: true, staffName: true, value: true } }),
    prisma.product.findMany({ select: { id: true, category: true, name: true } }),
    prisma.signedBill.findMany({ where: { date: range, ...oWhere, approvalStatus: { not: 'REJECTED' } }, select: { outletId: true, serviceStaff: true, items: { select: { productId: true, productName: true, quantity: true, amount: true } } } }),
    prisma.cancellation.findMany({ where: { date: range, ...oWhere, status: 'APPROVED' }, select: { outletId: true, productId: true, productName: true, quantity: true, amount: true, staffName: true, collection: { select: { staffName: true } } } }),
  ])

  // Classify a product line as shisha / food / null.
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
  // Group staff case-insensitively so an uploaded "JAZILA" lines up with the
  // collection "Jazila" (display keeps the first-seen spelling).
  const staffBucket = (oid: string, name: string) => {
    const m = (staffMaps[oid] ||= new Map())
    const k = name.trim().toLowerCase()
    let s = m.get(k)
    if (!s) { s = { staffName: name.trim(), collection: 0, shisha: 0, food: 0 }; m.set(k, s) }
    return s
  }

  // Collections → Total Collection
  for (const c of cols) {
    if (!c.outletId) continue
    outletBucket(c.outletId).collection += c.total || 0
    if (c.staffName) staffBucket(c.outletId, c.staffName).collection += c.total || 0
  }
  // Uploaded shisha/food (gross)
  for (const m of metrics as { outletId: string | null; department: string; staffName: string; value: number }[]) {
    if (!m.outletId) continue
    const key: 'shisha' | 'food' | null = m.department === 'SHISHA' ? 'shisha' : m.department === 'FOOD' ? 'food' : null
    if (!key) continue
    outletBucket(m.outletId)[key] += m.value || 0
    if (m.staffName) { const s = staffBucket(m.outletId, m.staffName); if (key === 'shisha') s.shisha += m.value || 0; else s.food += m.value || 0 }
  }
  // Deduct signed-bill shisha/food (credit, not realised) — shisha by quantity, food by amount
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
  // Deduct approved-cancellation shisha/food
  for (const c of cancels as { outletId: string | null; productId: string | null; productName: string | null; quantity: number; amount: number; staffName: string | null; collection: { staffName: string | null } | null }[]) {
    if (!c.outletId) continue
    const cls = classify(c.productId, c.productName)
    if (!cls) continue
    const amt = cls === 'shisha' ? c.quantity || 0 : c.amount || 0
    const staff = c.staffName || c.collection?.staffName || null
    outletBucket(c.outletId)[cls] -= amt
    if (staff) { const s = staffBucket(c.outletId, staff); if (cls === 'shisha') s.shisha -= amt; else s.food -= amt }
  }

  // Floor at 0 (deductions can exceed gross on incomplete data) + round + serialize
  const flo = (n: number) => roundMoney(Math.max(0, n))
  const byStaff: Record<string, { staffName: string; collection: number; shisha: number; food: number }[]> = {}
  for (const [oid, m] of Object.entries(staffMaps)) {
    byStaff[oid] = [...m.values()].map((s) => ({ staffName: s.staffName, collection: flo(s.collection), shisha: flo(s.shisha), food: flo(s.food) }))
  }
  for (const id of Object.keys(byOutlet)) {
    byOutlet[id] = { collection: flo(byOutlet[id].collection), shisha: flo(byOutlet[id].shisha), food: flo(byOutlet[id].food) }
  }

  return NextResponse.json({ outlets, byOutlet, byStaff })
}
