import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, MGMT_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

interface Agg {
  staff: string; days: number; systemSales: number; collected: number
  creditIssued: number; paidStaffLoss: number; discount: number; cancellations: number
  eventsWorked: number; eventsAttended: number; eventSales: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * Per-staff performance scorecard over a period. Aggregates daily collections
 * and approved cancellations (collection-linked ones resolve to the collection's
 * staff). Net = System − Collected − Credit − Paid(StaffLoss) − Discount −
 * Approved cancellations; positive = loss, negative = excess.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MGMT_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const start = parseD(searchParams.get('from')) || new Date()
  const end = parseD(searchParams.get('to')) || start
  const range = { gte: startOfDay(start), lte: endOfDay(end) }

  const baseWhere: Record<string, unknown> = { date: range }
  if (outletId) baseWhere.outletId = outletId

  const [cols, cancels, eventStaff] = await Promise.all([
    prisma.dailyCollection.findMany({ where: baseWhere, select: { staffName: true, systemSales: true, total: true, creditSales: true, paymentsReceived: true, discount: true } }),
    prisma.cancellation.findMany({ where: { date: range, ...(outletId ? { outletId } : {}), status: 'APPROVED' }, select: { staffName: true, amount: true, collection: { select: { staffName: true } } } }),
    // Event work is its own (Tips Events) outlet, so it's matched by staff name
    // across the period — independent of the operating-outlet filter.
    db.eventStaff.findMany({ where: { event: { date: range } }, select: { staffName: true, attended: true, salesAttributed: true } }),
  ])

  const map = new Map<string, Agg>()
  const get = (k: string) => {
    let a = map.get(k)
    if (!a) { a = { staff: k, days: 0, systemSales: 0, collected: 0, creditIssued: 0, paidStaffLoss: 0, discount: 0, cancellations: 0, eventsWorked: 0, eventsAttended: 0, eventSales: 0 }; map.set(k, a) }
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

  // Attach event performance, matching staff by name (case-insensitive). When an
  // outlet filter is active we only enrich staff already on the board; with "All
  // Outlets" we also surface staff who only worked events in the period.
  const norm = (s: string) => s.trim().toLowerCase()
  const byNorm = new Map<string, Agg>()
  for (const a of map.values()) byNorm.set(norm(a.staff), a)
  for (const e of eventStaff as { staffName: string; attended: boolean; salesAttributed: number }[]) {
    const nm = e.staffName || 'Unassigned'
    let a = byNorm.get(norm(nm))
    if (!a) { if (outletId) continue; a = get(nm); byNorm.set(norm(nm), a) }
    a.eventsWorked += 1
    if (e.attended) a.eventsAttended += 1
    a.eventSales += e.salesAttributed || 0
  }

  const rows = [...map.values()].map((a) => {
    const net = roundMoney(a.systemSales - a.collected - a.creditIssued - a.paidStaffLoss - a.discount - a.cancellations)
    return {
      staff: a.staff, days: a.days,
      systemSales: roundMoney(a.systemSales), collected: roundMoney(a.collected),
      creditIssued: roundMoney(a.creditIssued), discount: roundMoney(a.discount), cancellations: roundMoney(a.cancellations),
      collectionRate: a.systemSales > 0 ? Math.round((a.collected / a.systemSales) * 100) : 0,
      loss: net > 0 ? net : 0, excess: net < 0 ? -net : 0, net,
      eventsWorked: a.eventsWorked, eventsAttended: a.eventsAttended, eventSales: roundMoney(a.eventSales),
    }
  }).sort((x, y) => y.systemSales - x.systemSales)

  const totals = rows.reduce((t, r) => ({
    systemSales: t.systemSales + r.systemSales, collected: t.collected + r.collected,
    loss: t.loss + r.loss, excess: t.excess + r.excess,
  }), { systemSales: 0, collected: 0, loss: 0, excess: 0 })

  return NextResponse.json({ rows, totals })
}
