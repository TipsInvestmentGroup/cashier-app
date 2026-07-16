import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { CREDIT_BILL_TYPES } from '@/lib/bill-types'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Day-by-day breakdown for one staff (or outlet) over a period.
 * Columns: Date, System Sales, Collection, Signed Bills (credit sales,
 * excluding the auto staff-loss), Paid Bills, Difference/Shortage, Net.
 *   Difference = System − Collection − Signed − Paid   (positive = shortage)
 *   Net        = Collection + Paid (non-payroll)
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key') || ''
  const byOutlet = searchParams.get('groupBy') === 'outlet'
  const outletId = searchParams.get('outletId')
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  let start = parseD(searchParams.get('from'))
  let end = parseD(searchParams.get('to'))
  if (!start || !end) { const d = parseD(searchParams.get('date')) || new Date(); start = d; end = d }
  const range = { gte: startOfDay(start), lte: endOfDay(end) }
  const gb = searchParams.get('groupBy')
  const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10)
  const joinStaff = (set: Set<string>) => [...set].filter(Boolean).join(', ')

  // --- Customer detail: date, debt, paid, outstanding, service staff ---
  if (gb === 'customer') {
    const [signed, paid] = await Promise.all([
      prisma.signedBill.findMany({ where: { date: range, billType: 'CUSTOMER', personName: key, ...(outletId ? { outletId } : {}) }, select: { date: true, amount: true, serviceStaff: true } }),
      prisma.paidBill.findMany({ where: { date: range, payerCategory: 'Customer', payerName: key, ...(outletId ? { outletId } : {}) }, select: { date: true, amountPaid: true } }),
    ])
    const m = new Map<string, { date: string; debt: number; paid: number; staff: Set<string> }>()
    const g = (d: Date) => { const k = dayKey(d); let r = m.get(k); if (!r) { r = { date: k, debt: 0, paid: 0, staff: new Set() }; m.set(k, r) } return r }
    for (const s of signed) { const r = g(s.date); r.debt += s.amount; if (s.serviceStaff) r.staff.add(s.serviceStaff) }
    for (const p of paid) g(p.date).paid += p.amountPaid
    const rows = [...m.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, debt: r.debt, paid: r.paid, outstanding: r.debt - r.paid, serviceStaff: joinStaff(r.staff) }))
    const totals = rows.reduce((t, r) => ({ debt: t.debt + r.debt, paid: t.paid + r.paid, outstanding: t.outstanding + r.outstanding }), { debt: 0, paid: 0, outstanding: 0 })
    return NextResponse.json({ kind: 'customer', key, rows, totals })
  }

  // --- Admin / Director detail: date, spent, credit limit, exceeded, service staff ---
  if (gb === 'admin' || gb === 'director') {
    const type = gb.toUpperCase()
    const [signed, person] = await Promise.all([
      prisma.signedBill.findMany({ where: { date: range, billType: type, personName: key, ...(outletId ? { outletId } : {}) }, select: { date: true, amount: true, serviceStaff: true } }),
      prisma.person.findFirst({ where: { type, name: key }, select: { creditLimit: true } }),
    ])
    const creditLimit = person?.creditLimit ?? 0
    const m = new Map<string, { date: string; spent: number; staff: Set<string> }>()
    const g = (d: Date) => { const k = dayKey(d); let r = m.get(k); if (!r) { r = { date: k, spent: 0, staff: new Set() }; m.set(k, r) } return r }
    for (const s of signed) { const r = g(s.date); r.spent += s.amount; if (s.serviceStaff) r.staff.add(s.serviceStaff) }
    // running cumulative so per-day "exceeded" sums to the final over-limit
    let cum = 0
    const rows = [...m.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => {
      const before = Math.max(0, cum - creditLimit)
      cum += r.spent
      const after = Math.max(0, cum - creditLimit)
      return { date: r.date, spent: r.spent, creditLimit, exceeded: after - before, serviceStaff: joinStaff(r.staff) }
    })
    const spent = rows.reduce((t, r) => t + r.spent, 0)
    const totals = { spent, creditLimit, exceeded: Math.max(0, spent - creditLimit) }
    return NextResponse.json({ kind: gb, key, creditLimit, rows, totals })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collWhere: any = { date: range }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signedWhere: any = { date: range, billType: { in: [...CREDIT_BILL_TYPES] } } // exclude STAFF_LOSS (that IS the shortage)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let paidWhere: any = { date: range }

  if (byOutlet) {
    const outlet = await prisma.outlet.findFirst({ where: { name: key }, select: { id: true } })
    const oid = outlet?.id || '__none__'
    collWhere.outletId = oid
    signedWhere.outletId = oid
    paidWhere.outletId = oid
  } else {
    collWhere.staffName = key
    signedWhere.serviceStaff = key
    if (outletId) { collWhere.outletId = outletId; signedWhere.outletId = outletId }
    const cols0 = await prisma.dailyCollection.findMany({ where: collWhere, select: { id: true } })
    paidWhere = { date: range, billRef: { in: cols0.map((c) => `COL-${c.id}`) } }
  }

  const [collections, signedBills, paidBills] = await Promise.all([
    prisma.dailyCollection.findMany({ where: collWhere, select: { date: true, systemSales: true, total: true } }),
    prisma.signedBill.findMany({ where: signedWhere, select: { date: true, amount: true } }),
    prisma.paidBill.findMany({ where: paidWhere, select: { date: true, amountPaid: true, paymentMethod: true } }),
  ])

  type Day = { date: string; system: number; collection: number; signed: number; paid: number; paidCash: number }
  const map = new Map<string, Day>()
  const get = (d: Date): Day => {
    const k = dayKey(d)
    let r = map.get(k)
    if (!r) { r = { date: k, system: 0, collection: 0, signed: 0, paid: 0, paidCash: 0 }; map.set(k, r) }
    return r
  }

  for (const c of collections) { const r = get(c.date); r.system += c.systemSales || 0; r.collection += c.total }
  for (const b of signedBills) { get(b.date).signed += b.amount }
  for (const p of paidBills) { const r = get(p.date); r.paid += p.amountPaid; if (p.paymentMethod !== 'PAYROLL') r.paidCash += p.amountPaid }

  const rows = [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => ({
      date: r.date, system: r.system, collection: r.collection, signed: r.signed, paid: r.paid,
      difference: r.system - r.collection - r.signed - r.paid,
      net: r.collection + r.paidCash,
    }))

  const totals = rows.reduce(
    (t, r) => ({ system: t.system + r.system, collection: t.collection + r.collection, signed: t.signed + r.signed, paid: t.paid + r.paid, difference: t.difference + r.difference, net: t.net + r.net }),
    { system: 0, collection: 0, signed: 0, paid: 0, difference: 0, net: 0 }
  )

  return NextResponse.json({ key, rows, totals })
}
