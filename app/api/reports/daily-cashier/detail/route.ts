import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
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

  const SIGNED_CREDIT = ['ADMIN', 'DIRECTOR', 'CUSTOMER', 'TIPS', 'DJ'] // exclude STAFF_LOSS (that IS the shortage)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collWhere: any = { date: range }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signedWhere: any = { date: range, billType: { in: SIGNED_CREDIT } }
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
  const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10)
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
