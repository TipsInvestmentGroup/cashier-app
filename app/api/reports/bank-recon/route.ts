import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Bank Reconciliation report — per day, per channel:
 *   Paid bills + Sales collection = Total Collection (cashier's tally),
 *   Reported (system: collections + paid bills), Verified (officer's total),
 *   Variance = Total − Reported (positive = Excess, negative = Loss), Reason.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = user.role === 'CASHIER' ? user.outletId : searchParams.get('outletId')
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  let start = parseD(searchParams.get('from'))
  let end = parseD(searchParams.get('to'))
  if (!start || !end) { const d = parseD(searchParams.get('date')) || new Date(); start = d; end = d }
  const range = { gte: startOfDay(start), lte: endOfDay(end) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = { date: range }
  if (outletId) f.outletId = outletId

  const recons = await prisma.bankRecon.findMany({ where: f, orderBy: { date: 'asc' }, select: { date: true, channel: true, reportedAmount: true, paidBills: true, salesCollection: true, verifiedAmount: true, reason: true, verifiedBy: true } })

  const rows = recons.map((r) => {
    // Total [Channel] Collection = Paid bills + Sales collection (cashier's tally).
    const hasTotal = r.paidBills != null || r.salesCollection != null
    const total = (r.paidBills || 0) + (r.salesCollection || 0)
    return {
      date: new Date(r.date).toISOString().slice(0, 10),
      channel: r.channel || 'ALL',
      paidBills: r.paidBills, salesCollection: r.salesCollection,
      total: hasTotal ? total : null,
      reported: r.reportedAmount,
      // Variance = Total Collection (cashier) − Reported (system). >0 excess, <0 loss.
      variance: hasTotal ? total - r.reportedAmount : null,
      verified: r.verifiedAmount,
      verifiedSet: r.verifiedAmount != null,
      // Verified variance = Verified total − Reported (officer vs system)
      verifiedVariance: r.verifiedAmount != null ? r.verifiedAmount - r.reportedAmount : null,
      reason: r.reason || '',
      verifiedBy: r.verifiedBy || '',
    }
  })

  const totals = rows.reduce(
    (t, r) => ({ total: t.total + (r.total || 0), reported: t.reported + r.reported, verified: t.verified + (r.verified || 0), variance: t.variance + (r.variance || 0), verifiedVariance: t.verifiedVariance + (r.verifiedVariance || 0) }),
    { total: 0, reported: 0, verified: 0, variance: 0, verifiedVariance: 0 }
  )

  return NextResponse.json({ rows, totals })
}
