import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { canManageFunds, isOwner } from '@/lib/petty-access'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * Accountant petty cash ledger report.
 * Returns per-fund opening balance, deposits (debit), expenses (credit), and closing balance
 * for the given date range.
 * Query params: from, to, outletId, ownerName
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageFunds(user.role) && !isOwner(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const ownerName = searchParams.get('ownerName') || null

  const parseD = (s: string | null) => {
    if (!s) return null
    const p = parse(s, 'yyyy-MM-dd', new Date())
    return isValid(p) ? p : null
  }
  const to = parseD(searchParams.get('to')) || new Date()
  const from = parseD(searchParams.get('from')) || to
  const periodStart = startOfDay(from)
  const periodEnd = endOfDay(to)

  const where: Record<string, unknown> = { isActive: true }
  if (outletId) where.outletId = outletId

  // ownerName is filtered case-insensitively below in JS, not via Prisma's
  // `mode: 'insensitive'` — that option is Postgres-only and throws on SQLite
  // (this app's local/dev datasource). A raw equality filter here would
  // silently return zero funds on any casing mismatch, easy to mistake for
  // "no data," so match the case-insensitive convention used everywhere else
  // in this codebase (email/name comparisons) instead.
  let funds = await db.pettyFund.findMany({
    where,
    include: { txns: { orderBy: { createdAt: 'asc' } } },
  })
  if (ownerName) {
    const target = ownerName.trim().toLowerCase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    funds = funds.filter((f: any) => (f.ownerName || '').trim().toLowerCase() === target)
  }

  const outlets = await prisma.outlet.findMany({ select: { id: true, name: true } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outletLabel = (id: string | null) => (outlets as any[]).find((o) => o.id === id)?.name || 'Unassigned'

  // Fetch purposes for all linked petty cash payments
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allPcIds: string[] = funds.flatMap((f: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    f.txns.filter((t: any) => t.pettyCashId).map((t: any) => t.pettyCashId as string)
  )
  const purposes: Record<string, string> = {}
  if (allPcIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pc = await db.pettyCash.findMany({ where: { id: { in: allPcIds } }, select: { id: true, purpose: true } }) as any[]
    for (const p of pc) purposes[p.id] = p.purpose
  }

  let totalOpening = 0, totalDeposits = 0, totalExpenses = 0, totalClosing = 0

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fundRows = (funds as any[]).map((fund) => {
    // Opening = fund's all-time opening + all transactions before the period start
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const priorSum = fund.txns.filter((t: any) => new Date(t.createdAt) < periodStart)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .reduce((s: number, t: any) => s + t.amount, 0)
    const openingBalance = roundMoney((fund.openingBalance || 0) + priorSum)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const periodTxns = fund.txns.filter((t: any) => {
      const d = new Date(t.createdAt)
      return d >= periodStart && d <= periodEnd
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deposits = roundMoney(periodTxns.filter((t: any) => t.type === 'REPLENISH').reduce((s: number, t: any) => s + t.amount, 0))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const expenses = roundMoney(Math.abs(periodTxns.filter((t: any) => t.type === 'PAYMENT').reduce((s: number, t: any) => s + t.amount, 0)))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adjustments = roundMoney(periodTxns.filter((t: any) => t.type === 'ADJUST').reduce((s: number, t: any) => s + t.amount, 0))
    const closingBalance = roundMoney(openingBalance + deposits - expenses + adjustments)

    totalOpening = roundMoney(totalOpening + openingBalance)
    totalDeposits = roundMoney(totalDeposits + deposits)
    totalExpenses = roundMoney(totalExpenses + expenses)
    totalClosing = roundMoney(totalClosing + closingBalance)

    return {
      id: fund.id,
      name: fund.name,
      ownerName: fund.ownerName || '—',
      outletName: outletLabel(fund.outletId),
      openingBalance,
      deposits,
      expenses,
      adjustments,
      closingBalance,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      txns: periodTxns.map((t: any) => ({
        id: t.id,
        date: t.createdAt,
        type: t.type,
        amount: t.amount,
        note: t.note,
        createdByName: t.createdByName,
        purpose: t.pettyCashId ? (purposes[t.pettyCashId] || null) : null,
      })),
    }
  })

  return NextResponse.json({
    from,
    to,
    funds: fundRows,
    totals: {
      openingBalance: totalOpening,
      deposits: totalDeposits,
      expenses: totalExpenses,
      closingBalance: totalClosing,
    },
  })
}
