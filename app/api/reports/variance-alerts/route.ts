import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Reconciliation variance alerts for a day: cash (verified − expected closing)
 * and digital per channel (collected − system reported). Cashier-scoped.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const p = parse(searchParams.get('date') || '', 'yyyy-MM-dd', new Date())
  const day = isValid(p) ? p : new Date()
  const range = { gte: startOfDay(day), lte: endOfDay(day) }

  const baseWhere: Record<string, unknown> = { date: range }
  if (outletId) baseWhere.outletId = outletId

  const [cash, bank, outlets] = await Promise.all([
    prisma.cashRecon.findMany({ where: baseWhere, select: { outletId: true, closingBalance: true, verifiedAmount: true } }),
    prisma.bankRecon.findMany({ where: { ...baseWhere, channel: { not: null } }, select: { outletId: true, channel: true, reportedAmount: true, openingBalance: true, closingBalance: true, verifiedAmount: true } }),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
  ])
  const outletName = (id?: string | null) => outlets.find((o) => o.id === id)?.name || 'Outlet'

  const items: { outlet: string; kind: string; expected: number; actual: number; variance: number }[] = []

  for (const c of cash) {
    if (c.verifiedAmount == null) continue
    const v = roundMoney(c.verifiedAmount - c.closingBalance)
    if (v !== 0) items.push({ outlet: outletName(c.outletId), kind: 'Cash', expected: roundMoney(c.closingBalance), actual: roundMoney(c.verifiedAmount), variance: v })
  }
  for (const b of bank) {
    const collected = b.verifiedAmount != null ? b.verifiedAmount
      : (b.closingBalance != null && b.openingBalance != null ? b.closingBalance - b.openingBalance : null)
    if (collected == null) continue
    const v = roundMoney(collected - b.reportedAmount)
    if (v !== 0) items.push({ outlet: outletName(b.outletId), kind: b.channel || 'Digital', expected: roundMoney(b.reportedAmount), actual: roundMoney(collected), variance: v })
  }

  return NextResponse.json({ items, total: roundMoney(items.reduce((s, i) => s + Math.abs(i.variance), 0)) })
}
