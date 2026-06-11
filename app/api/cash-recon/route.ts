import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']

/** Computed cash figures for a day+outlet (collected / paid-cash / expenses). */
async function computeCash(dayStart: Date, dayEnd: Date, outletId?: string | null) {
  const range = { gte: dayStart, lte: dayEnd }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = { date: range }
  if (outletId) f.outletId = outletId
  const [coll, paid, petty] = await Promise.all([
    prisma.dailyCollection.aggregate({ where: f, _sum: { cash: true } }),
    prisma.paidBill.aggregate({ where: { ...f, paymentMethod: 'CASH' }, _sum: { amountPaid: true } }),
    prisma.pettyCash.aggregate({ where: { ...f, paymentMethod: 'CASH' }, _sum: { amount: true } }),
  ])
  return {
    cashCollected: coll._sum.cash || 0,
    paidBillsCash: paid._sum.amountPaid || 0,
    cashExpenses: petty._sum.amount || 0,
  }
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const dateParam = searchParams.get('date')

  // Single-day computed view (for the reconciliation form)
  if (dateParam) {
    const parsed = parse(dateParam, 'yyyy-MM-dd', new Date())
    const day = isValid(parsed) ? parsed : new Date()
    const computed = await computeCash(startOfDay(day), endOfDay(day), outletId)
    const existing = await prisma.cashRecon.findFirst({
      where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, ...(outletId ? { outletId } : {}) },
    })
    return NextResponse.json({ computed, existing })
  }

  // List
  const items = await prisma.cashRecon.findMany({
    where: outletId ? { outletId } : {},
    orderBy: { date: 'desc' },
    take: 200,
  })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { date, outletId, openingBalance = 0, cashDeposited = 0, notes } = body
  const day = date ? new Date(date) : new Date()
  const usedOutletId = outletId || user.outletId || null

  // One reconciliation per day+outlet — update if it exists
  const existing = await prisma.cashRecon.findFirst({
    where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, outletId: usedOutletId },
  })

  const data = {
    date: day,
    outletId: usedOutletId,
    openingBalance: Number(openingBalance) || 0,
    cashDeposited: Number(cashDeposited) || 0,
    notes: notes || null,
    cashierId: user.userId,
  }
  const item = existing
    ? await prisma.cashRecon.update({ where: { id: existing.id }, data })
    : await prisma.cashRecon.create({ data })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: existing ? 'UPDATE' : 'CREATE', entity: 'CashRecon', entityId: item.id, details: `Deposited ${data.cashDeposited}` },
  })

  return NextResponse.json(item, { status: 201 })
}
