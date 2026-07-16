import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { excessReasonLabel } from '@/lib/excess-reasons'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Cashier Excess & Loss report.
 *
 * Staff variance is read directly off the same ledgers Excess Recon uses —
 * NOT recomputed ad hoc — so the two views can never disagree:
 *   - Excess rows  = CollectionExcess line items (a collection can have several).
 *   - Loss rows    = the auto staff-loss SignedBill (voucherNumber SL-<collectionId>).
 * Both are kept in sync by lib/staff-loss.ts's recomputeStaffLoss whenever a
 * collection is edited or a linked cancellation is approved/rejected.
 *
 * Cashier cash-recon variance:   verified cash − expected closing balance.
 * Cashier digital-recon variance: collected (per channel) − system reported.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  // Cashiers are strictly locked to their own outlet.
  const outletId = readOutletScope(user, searchParams.get('outletId'))

  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const today = new Date()
  const start = parseD(searchParams.get('startDate')) || today
  const end = parseD(searchParams.get('endDate')) || start
  const range = { gte: startOfDay(start), lte: endOfDay(end) }

  const baseWhere: Record<string, unknown> = { date: range }
  if (outletId) baseWhere.outletId = outletId

  const [collections, cashRecons, bankRecons, outlets, staffLossBills] = await Promise.all([
    prisma.dailyCollection.findMany({ where: baseWhere, include: { cancellations: true, excessItems: true }, orderBy: { date: 'desc' } }),
    prisma.cashRecon.findMany({ where: baseWhere, orderBy: { date: 'desc' } }),
    prisma.bankRecon.findMany({ where: { ...baseWhere, channel: { not: null } }, orderBy: { date: 'desc' } }),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.signedBill.findMany({ where: { billType: 'STAFF_LOSS', date: range, ...(outletId ? { outletId } : {}) } }),
  ])
  const outletName = (id?: string | null) => outlets.find((o) => o.id === id)?.name || '—'
  const collectionById = new Map(collections.map((c) => [c.id, c]))

  // Shared breakdown columns for a collection, regardless of which side (excess/loss) is driving the row.
  const breakdown = (c: (typeof collections)[number]) => {
    const cancellations = roundMoney((c.cancellations || []).filter((x) => x.status !== 'REJECTED').reduce((s, x) => s + (x.amount || 0), 0))
    return {
      systemSales: roundMoney(c.systemSales || 0), collection: roundMoney(c.total),
      signed: roundMoney(c.creditSales || 0), cancellations, discount: roundMoney(c.discount || 0),
    }
  }

  // --- Staff excess: one row per CollectionExcess line item (never recomputed — read straight from the ledger) ---
  const excessRows = collections.flatMap((c) => (c.excessItems || []).map((it) => {
    const b = breakdown(c)
    return {
      id: it.id, date: c.date, outlet: outletName(c.outletId), staffName: it.staffName || it.personName || c.staffName || '—',
      reasonLabel: excessReasonLabel(it.reason),
      ...b, accounted: roundMoney(b.collection + b.signed + b.cancellations + b.discount), variance: roundMoney(it.amount),
    }
  }))

  // --- Staff loss: one row per auto staff-loss SignedBill (SL-<collectionId>) ---
  const lossRows = staffLossBills.map((bill) => {
    const collectionId = bill.voucherNumber.startsWith('SL-') ? bill.voucherNumber.slice(3) : null
    const c = collectionId ? collectionById.get(collectionId) : undefined
    const b = c ? breakdown(c) : { systemSales: 0, collection: 0, signed: 0, cancellations: 0, discount: 0 }
    return {
      id: bill.id, date: bill.date, outlet: outletName(bill.outletId), staffName: bill.personName || '—',
      ...b, accounted: roundMoney(b.collection + b.signed + b.cancellations + b.discount), variance: roundMoney(-bill.amount),
    }
  })

  const staff = [...excessRows, ...lossRows].filter((r) => r.variance !== 0)

  // --- Cashier cash-recon variance (verified vs expected) ---
  const cash = cashRecons
    .filter((r) => r.verifiedAmount != null)
    .map((r) => {
      const variance = roundMoney((r.verifiedAmount || 0) - r.closingBalance)
      return { id: r.id, date: r.date, outlet: outletName(r.outletId), expected: roundMoney(r.closingBalance), verified: roundMoney(r.verifiedAmount || 0), variance }
    })
    .filter((r) => r.variance !== 0)

  // --- Cashier digital-recon variance (collected vs reported) per channel ---
  const digital = bankRecons
    .map((r) => {
      const collected = r.verifiedAmount != null
        ? r.verifiedAmount
        : (r.closingBalance != null && r.openingBalance != null ? r.closingBalance - r.openingBalance : null)
      if (collected == null) return null
      const variance = roundMoney(collected - r.reportedAmount)
      return { id: r.id, date: r.date, outlet: outletName(r.outletId), channel: r.channel || '—', reported: roundMoney(r.reportedAmount), collected: roundMoney(collected), variance }
    })
    .filter((r): r is NonNullable<typeof r> => !!r && r.variance !== 0)

  return NextResponse.json({ staff, cash, digital })
}
