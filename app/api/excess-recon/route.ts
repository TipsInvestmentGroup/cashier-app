import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { excessReasonLabel } from '@/lib/excess-reasons'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

export interface ExcessReconRow {
  id: string
  source: 'CASH_RECON' | 'COLLECTION'
  date: string
  outlet: string
  person: string
  staffId: string | null
  personId: string | null
  excess: number
  reason: string
  reasonLabel: string
  paid: number
  balance: number
  status: 'PENDING' | 'SETTLED'
}

/** Consolidated Excess Recon ledger — merges Cash Reconciliation excess items
 *  and Collections excess into a single Paid/Balance view for fast settlement. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')
  const dateFilter = startDate && endDate ? { gte: new Date(startDate), lte: new Date(endDate) } : undefined

  const [cashItems, collectionItems] = await Promise.all([
    prisma.cashReconExcess.findMany({
      where: {
        cashRecon: { ...(outletId ? { outletId } : {}), ...(dateFilter ? { date: dateFilter } : {}) },
      },
      include: { cashRecon: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.collectionExcess.findMany({
      where: {
        collection: { ...(outletId ? { outletId } : {}), ...(dateFilter ? { date: dateFilter } : {}) },
      },
      include: { collection: { include: { outlet: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // CashRecon doesn't eager-load outlet name — resolve outlet names in one pass.
  const outletIds = Array.from(new Set(cashItems.map((it) => it.cashRecon.outletId).filter(Boolean))) as string[]
  const outlets = outletIds.length ? await prisma.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, name: true } }) : []
  const outletName = (id: string | null) => (id ? outlets.find((o) => o.id === id)?.name || '—' : '—')

  const rows: ExcessReconRow[] = [
    ...cashItems.map((it) => {
      const balance = Math.max(0, it.amount - it.paidAmount)
      return {
        id: it.id, source: 'CASH_RECON' as const,
        date: it.cashRecon.date.toISOString(),
        outlet: outletName(it.cashRecon.outletId),
        person: it.staffName || it.personName || '—',
        staffId: it.staffId, personId: it.personId,
        excess: it.amount, reason: it.reason, reasonLabel: excessReasonLabel(it.reason),
        paid: it.paidAmount, balance, status: (balance <= 0 ? 'SETTLED' : 'PENDING') as 'SETTLED' | 'PENDING',
      }
    }),
    ...collectionItems.map((it) => {
      const balance = Math.max(0, it.amount - it.paidAmount)
      return {
        id: it.id, source: 'COLLECTION' as const,
        date: it.collection.date.toISOString(),
        outlet: it.collection.outlet?.name || '—',
        person: it.staffName || it.personName || it.collection.staffName || '—',
        staffId: it.staffId, personId: it.personId,
        excess: it.amount, reason: it.reason, reasonLabel: excessReasonLabel(it.reason),
        paid: it.paidAmount, balance, status: (balance <= 0 ? 'SETTLED' : 'PENDING') as 'SETTLED' | 'PENDING',
      }
    }),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return NextResponse.json(rows)
}
