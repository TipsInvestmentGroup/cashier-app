import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Actuals for target tracking over a window: per-outlet and per-staff totals for
 * Total Collection (from daily collections), Shisha and Food (from uploaded
 * SalesMetric). Cashier-scoped to their own outlet.
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
  const where: Record<string, unknown> = { date: range }
  if (outletId) where.outletId = outletId

  const [outlets, cols, metrics] = await Promise.all([
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.dailyCollection.findMany({ where, select: { outletId: true, staffName: true, total: true } }),
    db.salesMetric.findMany({ where, select: { outletId: true, department: true, staffName: true, value: true } }),
  ])

  // byOutlet[outletId] = { collection, shisha, food }
  const byOutlet: Record<string, { collection: number; shisha: number; food: number }> = {}
  // byStaff[outletId] = Map staffName -> {collection, shisha, food}
  const staffMaps: Record<string, Map<string, { staffName: string; collection: number; shisha: number; food: number }>> = {}

  const outletBucket = (id: string) => (byOutlet[id] ||= { collection: 0, shisha: 0, food: 0 })
  const staffBucket = (oid: string, name: string) => {
    const m = (staffMaps[oid] ||= new Map())
    let s = m.get(name)
    if (!s) { s = { staffName: name, collection: 0, shisha: 0, food: 0 }; m.set(name, s) }
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
    const v = m.value || 0
    outletBucket(m.outletId)[key] += v
    if (m.staffName) {
      const s = staffBucket(m.outletId, m.staffName)
      if (key === 'shisha') s.shisha += v
      else s.food += v
    }
  }

  // Round + serialize staff maps to arrays
  const byStaff: Record<string, { staffName: string; collection: number; shisha: number; food: number }[]> = {}
  for (const [oid, m] of Object.entries(staffMaps)) {
    byStaff[oid] = [...m.values()].map((s) => ({ staffName: s.staffName, collection: roundMoney(s.collection), shisha: roundMoney(s.shisha), food: roundMoney(s.food) }))
  }
  for (const id of Object.keys(byOutlet)) {
    byOutlet[id] = { collection: roundMoney(byOutlet[id].collection), shisha: roundMoney(byOutlet[id].shisha), food: roundMoney(byOutlet[id].food) }
  }

  return NextResponse.json({ outlets, byOutlet, byStaff })
}
