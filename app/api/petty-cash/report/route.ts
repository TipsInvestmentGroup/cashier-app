import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, CASHIER_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * Petty-cash reports & reconciliation for a window. Groups paid disbursements
 * by outlet, department, requester, disburser and type, and splits the
 * reconciliation into cashier-drawer cash vs accountant-fund payments.
 * Cashier-scoped.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CASHIER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const to = parseD(searchParams.get('to')) || new Date()
  const from = parseD(searchParams.get('from')) || to

  const where: Record<string, unknown> = { date: { gte: startOfDay(from), lte: endOfDay(to) } }
  if (outletId) where.outletId = outletId

  const [items, outlets] = await Promise.all([
    db.pettyCash.findMany({ where, orderBy: { date: 'desc' } }),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outletName = (id: string | null) => outlets.find((o: any) => o.id === id)?.name || 'Unassigned'

  // Only settled disbursements count toward spend/reconciliation.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paid = items.filter((i: any) => i.paymentStatus === 'PAID')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupBy = (rows: any[], key: (i: any) => string) => {
    const m: Record<string, { label: string; count: number; amount: number }> = {}
    for (const i of rows) {
      const label = key(i) || '—'
      ;(m[label] ||= { label, count: 0, amount: 0 })
      m[label].count += 1
      m[label].amount = roundMoney(m[label].amount + (i.amount || 0))
    }
    return Object.values(m).sort((a, b) => b.amount - a.amount)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sum = (rows: any[]) => roundMoney(rows.reduce((s: number, i: any) => s + (i.amount || 0), 0))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cashier = paid.filter((i: any) => i.pettyType !== 'ACCOUNTANT')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accountant = paid.filter((i: any) => i.pettyType === 'ACCOUNTANT')

  return NextResponse.json({
    from, to,
    totals: {
      requested: sum(items),
      paid: sum(paid),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pending: sum(items.filter((i: any) => i.status === 'PENDING')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      approvedUnpaid: sum(items.filter((i: any) => i.status === 'APPROVED' && i.paymentStatus !== 'PAID')),
      cashierPaid: sum(cashier),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cashierCash: sum(cashier.filter((i: any) => i.paymentMethod === 'CASH')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cashierNonCash: sum(cashier.filter((i: any) => i.paymentMethod !== 'CASH')),
      accountantPaid: sum(accountant),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byOutlet: groupBy(paid, (i: any) => outletName(i.outletId)),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byDepartment: groupBy(paid, (i: any) => i.department || 'Unassigned'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byRequester: groupBy(paid, (i: any) => i.requestedBy),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byDisburser: groupBy(paid, (i: any) => i.paidByName || '—'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    byType: groupBy(paid, (i: any) => (i.pettyType === 'ACCOUNTANT' ? 'Accountant fund' : 'Cashier drawer')),
  })
}
