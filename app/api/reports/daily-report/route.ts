import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { resolveAccountId, resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { BILL_TYPE_CODES } from '@/lib/bill-types'
import { channelAmountsFor } from '@/lib/collection-channels-shared'
import { sumApprovedPettyCash } from '@/lib/petty-cash-metrics'
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

  // All signed bills (credit given) show in the report — Customer, Admin, Director,
  // Staff Loss, Tips and DJ alike. Only explicitly REJECTED requests are left out,
  // since a rejected bill is not a real debt.
  const signedWhere = { ...baseWhere, approvalStatus: { not: 'REJECTED' } }

  const [collections, signedBills, paidBills, cancellations, pettyCash, outletRec, allChannels] = await Promise.all([
    prisma.dailyCollection.findMany({ where: baseWhere, include: { outlet: { select: { name: true } }, channels: true } }),
    prisma.signedBill.findMany({ where: signedWhere, select: { billType: true, personName: true, serviceStaff: true, amount: true }, orderBy: { amount: 'desc' } }),
    prisma.paidBill.findMany({ where: baseWhere, select: { payerName: true, payerCategory: true, amountPaid: true, paymentMethod: true } }),
    prisma.cancellation.findMany({ where: { date: range, ...(outletId ? { outletId } : {}), status: { not: 'REJECTED' } }, select: { productName: true, staffName: true, quantity: true, amount: true, reason: true } }),
    prisma.pettyCash.findMany({ where: { date: range, ...(outletId ? { outletId } : {}) }, select: { purpose: true, requestedBy: true, department: true, amount: true, paymentMethod: true, status: true }, orderBy: { amount: 'desc' } }),
    outletId ? prisma.outlet.findUnique({ where: { id: outletId }, select: { name: true } }) : Promise.resolve(null),
    prisma.paymentChannel.findMany({ where: { isActive: true }, orderBy: { createdAt: 'asc' } }),
  ])
  const channelLabel = (code: string) => allChannels.find((c) => c.code === code)?.label || code

  // --- Collection totals: cash stays fixed, every digital channel is dynamic ---
  const channelTotals: Record<string, number> = {}
  const collection = collections.reduce(
    (t, c) => {
      t.systemSales += c.systemSales || 0
      t.cash += c.cash; t.total += c.total
      for (const [code, amt] of Object.entries(channelAmountsFor(c))) channelTotals[code] = (channelTotals[code] || 0) + amt
      return t
    },
    { systemSales: 0, cash: 0, total: 0 }
  )
  const variance = roundMoney(collection.total - collection.systemSales)
  // Order by the active-channel list first (so newly-disabled channels with historical amounts still show, appended after).
  const channelCodesInOrder = [...allChannels.map((c) => c.code).filter((code) => code !== 'CASH'), ...Object.keys(channelTotals).filter((code) => !allChannels.some((c) => c.code === code))]
  const collectionChannels = channelCodesInOrder
    .map((code) => ({ code, label: channelLabel(code), amount: roundMoney(channelTotals[code] || 0) }))
    .filter((c) => c.amount > 0 || allChannels.some((ch) => ch.code === c.code))

  // --- Signed bills by type + flat list ---
  const signedByType: Record<string, number> = Object.fromEntries(BILL_TYPE_CODES.map((k) => [k, 0]))
  const signedRows = signedBills.map((b) => {
    const type = String(b.billType).toUpperCase()
    if ((BILL_TYPE_CODES as readonly string[]).includes(type)) signedByType[type] += b.amount
    return { type, name: b.personName, staff: b.serviceStaff || '', amount: roundMoney(b.amount) }
  })
  const signedTotal = roundMoney(signedBills.reduce((s, b) => s + b.amount, 0))

  // --- Paid bills (debts collected) by method — any active channel, else "Other" ---
  const paidByMethodTotals: Record<string, number> = {}
  const paidRows = paidBills.map((p) => {
    const m = String(p.paymentMethod || '').toUpperCase()
    const key = allChannels.some((c) => c.code === m) ? m : 'OTHER'
    paidByMethodTotals[key] = (paidByMethodTotals[key] || 0) + p.amountPaid
    return { name: p.payerName, category: p.payerCategory || '', method: m || 'OTHER', amount: roundMoney(p.amountPaid) }
  })
  const paidByMethod = Object.entries(paidByMethodTotals).map(([code, amount]) => ({
    code, label: code === 'OTHER' ? 'Other' : channelLabel(code), amount: roundMoney(amount),
  }))
  const paidTotal = roundMoney(paidBills.reduce((s, p) => s + p.amountPaid, 0))
  const paidCash = roundMoney(paidByMethodTotals.CASH || 0)

  // --- Cancellations ---
  const cancelRows = cancellations.map((c) => ({ product: c.productName, staff: c.staffName || '', qty: c.quantity, amount: roundMoney(c.amount), reason: c.reason }))
  const cancelTotal = roundMoney(cancellations.reduce((s, c) => s + c.amount, 0))

  // --- Petty cash expenses ---
  const pettyRows = pettyCash.map((p) => ({ purpose: p.purpose, by: p.requestedBy, dept: p.department || '', method: p.paymentMethod, amount: roundMoney(p.amount), status: p.status }))
  const pettyTotal = roundMoney(pettyCash.reduce((s, p) => s + p.amount, 0))
  const pettyApproved = sumApprovedPettyCash(pettyCash)

  // --- Settlements paid out of the till (cash) ---
  // Cash physically leaves the drawer when a payable over-collection is paid
  // out, but that isn't an operational collection or petty cash. Derived
  // precisely from the GL: the Cash-account credits posted by excess
  // settlements (Dr Excess-Payable / Cr Cash), net of any unsettle reversals
  // (Dr Cash), on this day for this outlet. Falls back to 0 for a company with
  // no such postings, so nothing changes for outlets that don't use this.
  let settlementsPaidFromTill = 0
  const companyId = outletId
    ? (await prisma.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } }))?.companyId
    : await resolveDefaultCompanyId(prisma)
  if (companyId) {
    const cashAccountId = await resolveAccountId(prisma, { companyId, key: 'CASH' })
    const cashLines = await prisma.journalLine.findMany({
      where: {
        accountId: cashAccountId,
        ...(outletId ? { outletId } : {}),
        journalEntry: { sourceType: { in: ['ExcessSettlement', 'ExcessSettlementReversal', 'ExcessRefund', 'CashReconExcessPayout'] }, entryDate: range },
      },
      select: { debit: true, credit: true },
    })
    // credit = cash out (settlement), debit = cash back in (reversal)
    settlementsPaidFromTill = roundMoney(cashLines.reduce((s, l) => s + (l.credit || 0) - (l.debit || 0), 0))
  }

  // --- Cash in hand = cash collected + cash debts collected − approved petty cash − cash settlements paid out ---
  const cashInHand = roundMoney(collection.cash + paidCash - pettyApproved - settlementsPaidFromTill)

  const outletName = outletRec?.name || collections[0]?.outlet?.name || (outletId ? 'Outlet' : 'All Outlets')

  return NextResponse.json({
    date: startOfDay(day).toISOString(),
    outletName,
    generatedBy: user.name || '',
    collection: {
      systemSales: roundMoney(collection.systemSales),
      cash: roundMoney(collection.cash), channels: collectionChannels,
      total: roundMoney(collection.total), variance,
    },
    signed: { byType: signedByType, rows: signedRows, total: signedTotal },
    paid: { byMethod: paidByMethod, rows: paidRows, total: paidTotal, cash: paidCash },
    cancellations: { rows: cancelRows, total: cancelTotal },
    pettyCash: { rows: pettyRows, total: pettyTotal, approved: pettyApproved },
    settlementsPaidFromTill,
    cashInHand,
  })
}
