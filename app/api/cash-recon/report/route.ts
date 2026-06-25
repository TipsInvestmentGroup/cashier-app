import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Cashier cash management report for a date range.
 * Each row = one daily cash reconciliation record, enriched with
 * cash collected from sales, paid bills cash, and cashier petty cash expenses.
 * Query params: from, to, outletId
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))

  const parseD = (s: string | null) => {
    if (!s) return null
    const p = parse(s, 'yyyy-MM-dd', new Date())
    return isValid(p) ? p : null
  }
  const to = parseD(searchParams.get('to')) || new Date()
  const from = parseD(searchParams.get('from')) || to

  const where: Record<string, unknown> = { date: { gte: startOfDay(from), lte: endOfDay(to) } }
  if (outletId) where.outletId = outletId

  const recons = await prisma.cashRecon.findMany({ where, orderBy: { date: 'desc' } })

  const outlets = await prisma.outlet.findMany({ select: { id: true, name: true } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outletLabel = (id: string | null) => (outlets as any[]).find((o) => o.id === id)?.name || 'All Outlets'

  const rows = await Promise.all(
    recons.map(async (r) => {
      const day = new Date(r.date)
      const dayStart = startOfDay(day)
      const dayEnd = endOfDay(day)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f: any = { date: { gte: dayStart, lte: dayEnd } }
      if (r.outletId) f.outletId = r.outletId

      const [coll, paid, petty] = await Promise.all([
        prisma.dailyCollection.aggregate({ where: f, _sum: { cash: true } }),
        prisma.paidBill.aggregate({ where: { ...f, paymentMethod: 'CASH' }, _sum: { amountPaid: true } }),
        prisma.pettyCash.aggregate({
          where: { ...f, paymentMethod: 'CASH', paymentStatus: 'PAID', pettyType: 'CASHIER' },
          _sum: { amount: true },
        }),
      ])

      return {
        id: r.id,
        date: r.date,
        outletId: r.outletId,
        outletName: outletLabel(r.outletId),
        openingBalance: r.openingBalance,
        cashCollected: roundMoney(coll._sum.cash || 0),
        paidBillsCash: roundMoney(paid._sum.amountPaid || 0),
        cashierExpenses: roundMoney(petty._sum.amount || 0),
        cashDeposited: r.cashDeposited,
        closingBalance: r.closingBalance,
        verifiedAmount: r.verifiedAmount,
        notes: r.notes,
      }
    })
  )

  const zero = { openingBalance: 0, cashCollected: 0, paidBillsCash: 0, cashierExpenses: 0, cashDeposited: 0, closingBalance: 0 }
  const totals = rows.reduce(
    (acc, r) => ({
      openingBalance: roundMoney(acc.openingBalance + r.openingBalance),
      cashCollected: roundMoney(acc.cashCollected + r.cashCollected),
      paidBillsCash: roundMoney(acc.paidBillsCash + r.paidBillsCash),
      cashierExpenses: roundMoney(acc.cashierExpenses + r.cashierExpenses),
      cashDeposited: roundMoney(acc.cashDeposited + r.cashDeposited),
      closingBalance: roundMoney(acc.closingBalance + r.closingBalance),
    }),
    zero
  )

  return NextResponse.json({ from, to, rows, totals })
}
