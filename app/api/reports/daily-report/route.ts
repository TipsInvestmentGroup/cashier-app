import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Cashier Daily Report — a single, share-ready page for one outlet on one day.
 * Shows: collection (system sales vs money in), signed bills (credit given),
 * paid bills (debts collected), cancellations, and petty-cash expenses,
 * plus a computed Cash-in-Hand. Designed for a cashier to download/print
 * and share with directors (e.g. WhatsApp).
 *
 * Cashiers are locked to their own outlet; managers may pass ?outletId=.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = user.role === 'CASHIER' ? user.outletId : searchParams.get('outletId')

  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const day = parseD(searchParams.get('date')) || new Date()
  const range = { gte: startOfDay(day), lte: endOfDay(day) }

  const baseWhere: Record<string, unknown> = { date: range }
  if (outletId) baseWhere.outletId = outletId

  // Approval gate: Customer/Tips/DJ count only when APPROVED; the rest always count.
  const signedWhere = { ...baseWhere, OR: [{ approvalStatus: 'APPROVED' }, { billType: { notIn: ['CUSTOMER', 'TIPS', 'DJ'] } }] }

  const [collections, signedBills, paidBills, cancellations, pettyCash, outletRec] = await Promise.all([
    prisma.dailyCollection.findMany({ where: baseWhere, include: { outlet: { select: { name: true } } } }),
    prisma.signedBill.findMany({ where: signedWhere, select: { billType: true, personName: true, serviceStaff: true, amount: true }, orderBy: { amount: 'desc' } }),
    prisma.paidBill.findMany({ where: baseWhere, select: { payerName: true, payerCategory: true, amountPaid: true, paymentMethod: true } }),
    prisma.cancellation.findMany({ where: { date: range, ...(outletId ? { outletId } : {}), status: { not: 'REJECTED' } }, select: { productName: true, staffName: true, quantity: true, amount: true, reason: true } }),
    prisma.pettyCash.findMany({ where: { date: range, ...(outletId ? { outletId } : {}) }, select: { purpose: true, requestedBy: true, department: true, amount: true, paymentMethod: true, status: true }, orderBy: { amount: 'desc' } }),
    outletId ? prisma.outlet.findUnique({ where: { id: outletId }, select: { name: true } }) : Promise.resolve(null),
  ])

  // --- Collection totals (4 fixed channels) ---
  const collection = collections.reduce(
    (t, c) => {
      t.systemSales += c.systemSales || 0
      t.cash += c.cash; t.crdb += c.crdb; t.stanbic += c.stanbic; t.mpesa += c.mpesa; t.total += c.total
      return t
    },
    { systemSales: 0, cash: 0, crdb: 0, stanbic: 0, mpesa: 0, total: 0 }
  )
  const variance = roundMoney(collection.total - collection.systemSales)

  // --- Signed bills by type + flat list ---
  const SIGNED_KEYS = ['ADMIN', 'DIRECTOR', 'CUSTOMER', 'TIPS', 'DJ', 'STAFF_LOSS']
  const signedByType: Record<string, number> = Object.fromEntries(SIGNED_KEYS.map((k) => [k, 0]))
  const signedRows = signedBills.map((b) => {
    const type = String(b.billType).toUpperCase()
    if (SIGNED_KEYS.includes(type)) signedByType[type] += b.amount
    return { type, name: b.personName, staff: b.serviceStaff || '', amount: roundMoney(b.amount) }
  })
  const signedTotal = roundMoney(signedBills.reduce((s, b) => s + b.amount, 0))

  // --- Paid bills (debts collected) by method ---
  const paidByMethod: Record<string, number> = { CASH: 0, CRDB: 0, STANBIC: 0, MPESA: 0, OTHER: 0 }
  const paidRows = paidBills.map((p) => {
    const m = String(p.paymentMethod || '').toUpperCase()
    const key = ['CASH', 'CRDB', 'STANBIC', 'MPESA'].includes(m) ? m : 'OTHER'
    paidByMethod[key] += p.amountPaid
    return { name: p.payerName, category: p.payerCategory || '', method: m || 'OTHER', amount: roundMoney(p.amountPaid) }
  })
  const paidTotal = roundMoney(paidBills.reduce((s, p) => s + p.amountPaid, 0))
  const paidCash = roundMoney(paidByMethod.CASH)

  // --- Cancellations ---
  const cancelRows = cancellations.map((c) => ({ product: c.productName, staff: c.staffName || '', qty: c.quantity, amount: roundMoney(c.amount), reason: c.reason }))
  const cancelTotal = roundMoney(cancellations.reduce((s, c) => s + c.amount, 0))

  // --- Petty cash expenses ---
  const pettyRows = pettyCash.map((p) => ({ purpose: p.purpose, by: p.requestedBy, dept: p.department || '', method: p.paymentMethod, amount: roundMoney(p.amount), status: p.status }))
  const pettyTotal = roundMoney(pettyCash.reduce((s, p) => s + p.amount, 0))
  const pettyApproved = roundMoney(pettyCash.filter((p) => p.status === 'APPROVED').reduce((s, p) => s + p.amount, 0))

  // --- Cash in hand = cash collected + cash debts collected − approved petty cash paid out ---
  const cashInHand = roundMoney(collection.cash + paidCash - pettyApproved)

  const outletName = outletRec?.name || collections[0]?.outlet?.name || (outletId ? 'Outlet' : 'All Outlets')

  return NextResponse.json({
    date: startOfDay(day).toISOString(),
    outletName,
    generatedBy: user.name || '',
    collection: {
      systemSales: roundMoney(collection.systemSales),
      cash: roundMoney(collection.cash), crdb: roundMoney(collection.crdb),
      stanbic: roundMoney(collection.stanbic), mpesa: roundMoney(collection.mpesa),
      total: roundMoney(collection.total), variance,
    },
    signed: { byType: signedByType, rows: signedRows, total: signedTotal },
    paid: { byMethod: paidByMethod, rows: paidRows, total: paidTotal, cash: paidCash },
    cancellations: { rows: cancelRows, total: cancelTotal },
    pettyCash: { rows: pettyRows, total: pettyTotal, approved: pettyApproved },
    cashInHand,
  })
}
