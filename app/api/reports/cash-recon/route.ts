import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Cash Reconciliation report — per day:
 *   Opening balance, cash collected from staff, paid bills (cash),
 *   cash expenses (cash requests), cash deposited to bank, closing balance.
 *   Closing = Opening + Collected + PaidCash − Expenses − Deposited
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

  const [collections, paid, petty, recons] = await Promise.all([
    prisma.dailyCollection.findMany({ where: f, select: { date: true, cash: true } }),
    prisma.paidBill.findMany({ where: { ...f, paymentMethod: 'CASH' }, select: { date: true, amountPaid: true } }),
    prisma.pettyCash.findMany({ where: { ...f, paymentMethod: 'CASH' }, select: { date: true, amount: true } }),
    prisma.cashRecon.findMany({ where: f, select: { date: true, openingBalance: true, cashDeposited: true, verifiedAmount: true, verifiedBy: true } }),
  ])

  type Day = { date: string; opening: number; collected: number; paidCash: number; expenses: number; deposited: number; verified: number; verifiedSet: boolean; verifiedBy: string }
  const map = new Map<string, Day>()
  const dayKey = (d: Date) => new Date(d).toISOString().slice(0, 10)
  const g = (d: Date): Day => {
    const k = dayKey(d)
    let r = map.get(k)
    if (!r) { r = { date: k, opening: 0, collected: 0, paidCash: 0, expenses: 0, deposited: 0, verified: 0, verifiedSet: false, verifiedBy: '' }; map.set(k, r) }
    return r
  }
  for (const c of collections) g(c.date).collected += c.cash
  for (const p of paid) g(p.date).paidCash += p.amountPaid
  for (const e of petty) g(e.date).expenses += e.amount
  for (const r of recons) {
    const d = g(r.date)
    d.opening += r.openingBalance; d.deposited += r.cashDeposited
    if (r.verifiedAmount != null) { d.verified += r.verifiedAmount; d.verifiedSet = true; if (r.verifiedBy) d.verifiedBy = r.verifiedBy }
  }

  const rows = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).map((r) => {
    const closing = r.opening + r.collected + r.paidCash - r.expenses - r.deposited
    return { ...r, closing, variance: r.verifiedSet ? r.verified - closing : null }
  })

  const totals = rows.reduce(
    (t, r) => ({
      opening: t.opening + r.opening, collected: t.collected + r.collected, paidCash: t.paidCash + r.paidCash,
      expenses: t.expenses + r.expenses, deposited: t.deposited + r.deposited, closing: t.closing + r.closing,
      verified: t.verified + r.verified, variance: t.variance + (r.variance || 0),
    }),
    { opening: 0, collected: 0, paidCash: 0, expenses: 0, deposited: 0, closing: 0, verified: 0, variance: 0 }
  )

  return NextResponse.json({ rows, totals })
}
