import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** Read-only "Cancellation" Reconciliation section (§11) — tracking only, no
 *  payment workflow. Reuses the existing Cancellation model. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const rows = await prisma.cancellation.findMany({
    where: {
      ...(outletId ? { outletId } : {}),
      ...(startDate && endDate ? { date: { gte: new Date(startDate), lte: new Date(endDate) } } : {}),
    },
    include: { collection: { select: { staffName: true } } },
    orderBy: { date: 'desc' },
    take: 300,
  })

  // Cancellation has no `cashier` relation (only cashierId) — resolve names in one pass.
  const cashierIds = Array.from(new Set(rows.map((r) => r.cashierId)))
  const cashiers = cashierIds.length ? await prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } }) : []
  const cashierName = (id: string) => cashiers.find((c) => c.id === id)?.name || '—'

  return NextResponse.json(rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString(),
    cashier: cashierName(r.cashierId),
    amount: r.amount,
    reason: r.reason,
    serviceStaff: r.staffName || r.collection?.staffName || '—',
    approvedBy: r.approvedBy || '—',
    status: r.status,
  })))
}
