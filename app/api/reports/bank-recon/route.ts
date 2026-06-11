import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Bank Reconciliation report — per day:
 *   Reported (by cashier), Verified (by reconciliation officer),
 *   Variance = Reported − Verified (positive = Loss, negative = Excess), Reason.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  let start = parseD(searchParams.get('from'))
  let end = parseD(searchParams.get('to'))
  if (!start || !end) { const d = parseD(searchParams.get('date')) || new Date(); start = d; end = d }
  const range = { gte: startOfDay(start), lte: endOfDay(end) }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = { date: range }
  if (outletId) f.outletId = outletId

  const recons = await prisma.bankRecon.findMany({ where: f, orderBy: { date: 'asc' }, select: { date: true, reportedAmount: true, verifiedAmount: true, reason: true } })

  const rows = recons.map((r) => ({
    date: new Date(r.date).toISOString().slice(0, 10),
    reported: r.reportedAmount,
    verified: r.verifiedAmount,
    variance: r.reportedAmount - r.verifiedAmount,
    reason: r.reason || '',
  }))

  const totals = rows.reduce(
    (t, r) => ({ reported: t.reported + r.reported, verified: t.verified + r.verified, variance: t.variance + r.variance }),
    { reported: 0, verified: 0, variance: 0 }
  )

  return NextResponse.json({ rows, totals })
}
