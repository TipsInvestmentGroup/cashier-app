import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

interface Agg {
  staff: string; days: number; systemSales: number; collected: number
  creditIssued: number; paidStaffLoss: number; discount: number; cancellations: number
}

/**
 * Per-staff performance scorecard over a period. Aggregates daily collections
 * and approved cancellations (collection-linked ones resolve to the collection's
 * staff). Net = System − Collected − Credit − Paid(StaffLoss) − Discount −
 * Approved cancellations; positive = loss, negative = excess.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const start = parseD(searchParams.get('from')) || new Date()
  const end = parseD(searchParams.get('to')) || start
  const range = { gte: startOfDay(start), lte: endOfDay(end) }

  const baseWhere: Record<string, unknown> = { date: range }
  if (outletId) baseWhere.outletId = outletId

  const [cols, cancels] = await Promise.all([
    prisma.dailyCollection.findMany({ where: baseWhere, select: { staffName: true, systemSales: true, total: true, creditSales: true, paymentsReceived: true, discount: true } }),
    prisma.cancellation.findMany({ where: { date: range, ...(outletId ? { outletId } : {}), status: 'APPROVED' }, select: { staffName: true, amount: true, collection: { select: { staffName: true } } } }),
  ])

  const map = new Map<string, Agg>()
  const get = (k: string) => {
    let a = map.get(k)
    if (!a) { a = { staff: k, days: 0, systemSales: 0, collected: 0, creditIssued: 0, paidStaffLoss: 0, discount: 0, cancellations: 0 }; map.set(k, a) }
    return a
  }
  for (const c of cols) {
    const a = get(c.staffName || 'Unassigned')
    a.days += 1
    a.systemSales += c.systemSales || 0
    a.collected += c.total || 0
    a.creditIssued += c.creditSales || 0
    a.paidStaffLoss += c.paymentsReceived || 0
    a.discount += c.discount || 0
  }
  for (const cn of cancels) {
    const k = cn.staffName || cn.collection?.staffName || 'Unassigned'
    get(k).cancellations += cn.amount || 0
  }

  const rows = [...map.values()].map((a) => {
    const net = roundMoney(a.systemSales - a.collected - a.creditIssued - a.paidStaffLoss - a.discount - a.cancellations)
    return {
      staff: a.staff, days: a.days,
      systemSales: roundMoney(a.systemSales), collected: roundMoney(a.collected),
      creditIssued: roundMoney(a.creditIssued), discount: roundMoney(a.discount), cancellations: roundMoney(a.cancellations),
      collectionRate: a.systemSales > 0 ? Math.round((a.collected / a.systemSales) * 100) : 0,
      loss: net > 0 ? net : 0, excess: net < 0 ? -net : 0, net,
    }
  }).sort((x, y) => y.systemSales - x.systemSales)

  const totals = rows.reduce((t, r) => ({
    systemSales: t.systemSales + r.systemSales, collected: t.collected + r.collected,
    loss: t.loss + r.loss, excess: t.excess + r.excess,
  }), { systemSales: 0, collected: 0, loss: 0, excess: 0 })

  return NextResponse.json({ rows, totals })
}
