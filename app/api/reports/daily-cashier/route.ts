import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Daily Cashier Report — per staff for a single day:
 *  - System sales, collection (cash/crdb/stanbic/mpesa/total)
 *  - Signed bills by type (Admin/Director/Customer/Tips/DJ/Staff Loss)
 *  - Paid bills by category (Admin/Director/Customer/Staff Loss)
 *  - Net Collection = collection total + paid bills (cash/crdb/stanbic/mpesa)
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }

  // Accept a range (from/to) or a single day (date). Defaults to today.
  let start = parseD(searchParams.get('from'))
  let end = parseD(searchParams.get('to'))
  if (!start || !end) {
    const d = parseD(searchParams.get('date')) || new Date()
    start = d; end = d
  }
  const range = { gte: startOfDay(start), lte: endOfDay(end) }

  const gb = searchParams.get('groupBy')

  // --- People groups (Customer / Admin / Director) — different columns ---
  if (gb === 'customer' || gb === 'admin' || gb === 'director') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sWhere: any = { date: range, billType: gb.toUpperCase() }
    if (outletId) sWhere.outletId = outletId

    if (gb === 'customer') {
      const [signed, paid] = await Promise.all([
        prisma.signedBill.findMany({ where: sWhere, select: { personName: true, amount: true } }),
        prisma.paidBill.findMany({ where: { date: range, payerCategory: 'Customer', ...(outletId ? { outletId } : {}) }, select: { payerName: true, amountPaid: true } }),
      ])
      const m = new Map<string, { name: string; debt: number; paid: number }>()
      const g = (n: string) => { let r = m.get(n); if (!r) { r = { name: n, debt: 0, paid: 0 }; m.set(n, r) } return r }
      for (const s of signed) g(s.personName).debt += s.amount
      for (const p of paid) g(p.payerName).paid += p.amountPaid
      const rows = [...m.values()].map((r) => ({ ...r, unpaid: r.debt - r.paid })).sort((a, b) => b.unpaid - a.unpaid)
      const totals = rows.reduce((t, r) => ({ debt: t.debt + r.debt, paid: t.paid + r.paid, unpaid: t.unpaid + r.unpaid }), { debt: 0, paid: 0, unpaid: 0 })
      return NextResponse.json({ kind: 'customer', rows, totals })
    }

    // admin / director
    const type = gb.toUpperCase()
    const [signed, persons] = await Promise.all([
      prisma.signedBill.findMany({ where: sWhere, select: { personName: true, amount: true } }),
      prisma.person.findMany({ where: { type }, select: { name: true, creditLimit: true } }),
    ])
    const limit = new Map(persons.map((p) => [p.name, p.creditLimit]))
    const m = new Map<string, { name: string; spent: number }>()
    for (const s of signed) { const r = m.get(s.personName) || { name: s.personName, spent: 0 }; r.spent += s.amount; m.set(s.personName, r) }
    const rows = [...m.values()].map((r) => {
      const creditLimit = limit.get(r.name) ?? 0
      return { name: r.name, spent: r.spent, creditLimit, deduction: Math.max(0, r.spent - creditLimit) }
    }).sort((a, b) => b.deduction - a.deduction || b.spent - a.spent)
    const totals = rows.reduce((t, r) => ({ spent: t.spent + r.spent, creditLimit: t.creditLimit + r.creditLimit, deduction: t.deduction + r.deduction }), { spent: 0, creditLimit: 0, deduction: 0 })
    return NextResponse.json({ kind: gb, rows, totals })
  }

  const byOutlet = gb === 'outlet'
  const where: Record<string, unknown> = { date: range }
  if (outletId) where.outletId = outletId

  const [collections, signedBills, paidBills] = await Promise.all([
    prisma.dailyCollection.findMany({ where, include: { outlet: { select: { name: true } } } }),
    prisma.signedBill.findMany({ where, select: { serviceStaff: true, billType: true, amount: true, outlet: { select: { name: true } } } }),
    prisma.paidBill.findMany({ where, select: { billRef: true, payerCategory: true, amountPaid: true, paymentMethod: true, outlet: { select: { name: true } } } }),
  ])

  // collection id → staff (to attribute paid bills entered during a collection)
  const colStaff = new Map<string, string>()
  for (const c of collections) if (c.staffName) colStaff.set(`COL-${c.id}`, c.staffName)

  type Row = {
    staffName: string
    outletName: string
    systemSales: number
    cash: number; crdb: number; stanbic: number; mpesa: number; total: number
    signed: Record<string, number>
    paid: Record<string, number>
    paidCashTotal: number
    netCollection: number
  }
  const SIGNED_KEYS = ['ADMIN', 'DIRECTOR', 'CUSTOMER', 'TIPS', 'DJ', 'STAFF_LOSS']
  const PAID_KEYS = ['ADMIN', 'DIRECTOR', 'CUSTOMER', 'STAFF_LOSS', 'OTHER']
  const blankSigned = () => Object.fromEntries([...SIGNED_KEYS, 'total'].map((k) => [k, 0]))
  const blankPaid = () => Object.fromEntries([...PAID_KEYS, 'total'].map((k) => [k, 0]))

  const rows = new Map<string, Row>()
  const rowFor = (staff: string, outletName = ''): Row => {
    let r = rows.get(staff)
    if (!r) {
      r = { staffName: staff, outletName, systemSales: 0, cash: 0, crdb: 0, stanbic: 0, mpesa: 0, total: 0, signed: blankSigned(), paid: blankPaid(), paidCashTotal: 0, netCollection: 0 }
      rows.set(staff, r)
    }
    return r
  }

  for (const c of collections) {
    const key = byOutlet ? (c.outlet?.name || '(No outlet)') : (c.staffName || '(Unassigned)')
    const r = rowFor(key, c.outlet?.name || '')
    r.systemSales += c.systemSales || 0
    r.cash += c.cash; r.crdb += c.crdb; r.stanbic += c.stanbic; r.mpesa += c.mpesa; r.total += c.total
    if (!r.outletName) r.outletName = c.outlet?.name || ''
  }

  for (const b of signedBills) {
    const type = String(b.billType).toUpperCase()
    if (!SIGNED_KEYS.includes(type)) continue
    const key = byOutlet ? (b.outlet?.name || '(No outlet)') : b.serviceStaff
    if (!key) continue
    const r = rowFor(key, b.outlet?.name || '')
    r.signed[type] += b.amount
    r.signed.total += b.amount
  }

  const CAT_MAP: Record<string, string> = { 'Admin': 'ADMIN', 'Director': 'DIRECTOR', 'Customer': 'CUSTOMER', 'Staff Loss': 'STAFF_LOSS' }
  for (const p of paidBills) {
    const key = byOutlet ? (p.outlet?.name || '(No outlet)') : ((p.billRef && colStaff.get(p.billRef)) || '(Other payments)')
    const r = rowFor(key, p.outlet?.name || '')
    const catKey = CAT_MAP[p.payerCategory || ''] || 'OTHER'
    r.paid[catKey] += p.amountPaid
    r.paid.total += p.amountPaid
    if (p.paymentMethod !== 'PAYROLL') r.paidCashTotal += p.amountPaid
  }

  // net collection
  const list = [...rows.values()]
  for (const r of list) r.netCollection = r.total + r.paidCashTotal
  list.sort((a, b) => b.netCollection - a.netCollection)

  const totals = list.reduce(
    (t, r) => {
      t.systemSales += r.systemSales; t.cash += r.cash; t.crdb += r.crdb; t.stanbic += r.stanbic; t.mpesa += r.mpesa
      t.total += r.total; t.signedTotal += r.signed.total; t.paidTotal += r.paid.total; t.netCollection += r.netCollection
      return t
    },
    { systemSales: 0, cash: 0, crdb: 0, stanbic: 0, mpesa: 0, total: 0, signedTotal: 0, paidTotal: 0, netCollection: 0 }
  )

  return NextResponse.json({ from: startOfDay(start).toISOString(), to: endOfDay(end).toISOString(), rows: list, totals, signedKeys: SIGNED_KEYS, paidKeys: PAID_KEYS })
}
