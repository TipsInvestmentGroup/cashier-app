import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Cashier Excess & Loss report.
 *
 * Staff variance (per daily collection):
 *   accounted = collection(cash+crdb+stanbic+mpesa) + signed bills + cancellations + discount
 *   variance  = accounted − system sales
 *     variance > 0 → staff EXCESS (accounted for more than the system says)
 *     variance < 0 → staff LOSS   (shortfall)
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

  const [collections, cashRecons, bankRecons, outlets] = await Promise.all([
    prisma.dailyCollection.findMany({ where: baseWhere, include: { cancellations: true }, orderBy: { date: 'desc' } }),
    prisma.cashRecon.findMany({ where: baseWhere, orderBy: { date: 'desc' } }),
    prisma.bankRecon.findMany({ where: { ...baseWhere, channel: { not: null } }, orderBy: { date: 'desc' } }),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
  ])
  const outletName = (id?: string | null) => outlets.find((o) => o.id === id)?.name || '—'

  // --- Staff variance (per collection) ---
  const staff = collections
    .filter((c) => (c.systemSales || 0) > 0)
    .map((c) => {
      const collection = c.total
      const signed = c.creditSales || 0
      const cancellations = roundMoney((c.cancellations || []).filter((x) => x.status !== 'REJECTED').reduce((s, x) => s + (x.amount || 0), 0))
      const discount = c.discount || 0
      const accounted = roundMoney(collection + signed + cancellations + discount)
      const variance = roundMoney(accounted - (c.systemSales || 0))
      return {
        id: c.id, date: c.date, outlet: outletName(c.outletId), staffName: c.staffName || '—',
        systemSales: roundMoney(c.systemSales || 0), collection: roundMoney(collection),
        signed: roundMoney(signed), cancellations, discount: roundMoney(discount),
        accounted, variance,
      }
    })
    .filter((r) => r.variance !== 0)

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
