import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid, differenceInCalendarDays, subDays } from 'date-fns'

/**
 * Side-by-side outlet comparison for a window: system sales, collected,
 * collection rate, variance, credit issued (signed), approved cancellations,
 * and growth vs the immediately-preceding equal-length window. Cashier-scoped.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const from = parseD(searchParams.get('from')) || new Date()
  const to = parseD(searchParams.get('to')) || from
  const len = differenceInCalendarDays(to, from) + 1
  const prevTo = subDays(from, 1)
  const prevFrom = subDays(prevTo, len - 1)

  const oWhere = outletId ? { outletId } : {}
  const cur = { gte: startOfDay(from), lte: endOfDay(to) }
  const prev = { gte: startOfDay(prevFrom), lte: endOfDay(prevTo) }

  const [outlets, cols, prevCols, signed, cancels] = await Promise.all([
    prisma.outlet.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.dailyCollection.findMany({ where: { date: cur, ...oWhere }, select: { outletId: true, systemSales: true, total: true } }),
    prisma.dailyCollection.findMany({ where: { date: prev, ...oWhere }, select: { outletId: true, total: true } }),
    prisma.signedBill.findMany({ where: { date: cur, ...oWhere, approvalStatus: { not: 'REJECTED' } }, select: { outletId: true, amount: true } }),
    prisma.cancellation.findMany({ where: { date: cur, ...(outletId ? { outletId } : {}), status: 'APPROVED' }, select: { outletId: true, amount: true } }),
  ])

  const agg: Record<string, { systemSales: number; collected: number; prevCollected: number; signed: number; cancellations: number }> = {}
  const b = (id: string | null) => { if (!id) return null; return (agg[id] ||= { systemSales: 0, collected: 0, prevCollected: 0, signed: 0, cancellations: 0 }) }
  cols.forEach((c) => { const x = b(c.outletId); if (x) { x.systemSales += c.systemSales || 0; x.collected += c.total || 0 } })
  prevCols.forEach((c) => { const x = b(c.outletId); if (x) x.prevCollected += c.total || 0 })
  signed.forEach((s) => { const x = b(s.outletId); if (x) x.signed += s.amount || 0 })
  cancels.forEach((c) => { const x = b(c.outletId); if (x) x.cancellations += c.amount || 0 })

  const rows = outlets
    .filter((o) => agg[o.id] && (agg[o.id].systemSales > 0 || agg[o.id].collected > 0 || agg[o.id].prevCollected > 0))
    .map((o) => {
      const a = agg[o.id]
      const growthPct = a.prevCollected > 0 ? Math.round(((a.collected - a.prevCollected) / a.prevCollected) * 1000) / 10 : a.collected > 0 ? 100 : 0
      return {
        outlet: o.name,
        systemSales: roundMoney(a.systemSales), collected: roundMoney(a.collected),
        collectionRate: a.systemSales > 0 ? Math.round((a.collected / a.systemSales) * 100) : 0,
        variance: roundMoney(a.collected - a.systemSales),
        signed: roundMoney(a.signed), cancellations: roundMoney(a.cancellations),
        prevCollected: roundMoney(a.prevCollected), growthPct,
      }
    })
    .sort((x, y) => y.collected - x.collected)

  return NextResponse.json({ rows, from, to, prevFrom, prevTo })
}
