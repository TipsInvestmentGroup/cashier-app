import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, writeOutletId } from '@/lib/auth'
import { canVerifyCash } from '@/lib/cash-verify'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']

/** Yesterday's (or the most recent prior) closing balance becomes today's opening. */
async function previousClosing(day: Date, outletId?: string | null): Promise<number> {
  const prev = await prisma.cashRecon.findFirst({
    where: { date: { lt: startOfDay(day) }, outletId: outletId || null },
    orderBy: { date: 'desc' },
  })
  return prev?.closingBalance || 0
}

/** Computed cash figures for a day+outlet (collected / paid-cash / expenses). */
async function computeCash(dayStart: Date, dayEnd: Date, outletId?: string | null) {
  const range = { gte: dayStart, lte: dayEnd }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = { date: range }
  if (outletId) f.outletId = outletId
  const [coll, paid, petty] = await Promise.all([
    prisma.dailyCollection.aggregate({ where: f, _sum: { cash: true } }),
    prisma.paidBill.aggregate({ where: { ...f, paymentMethod: 'CASH' }, _sum: { amountPaid: true } }),
    // Only cash actually disbursed from the cashier's drawer reduces it — paid,
    // CASH, and drawn from the cashier fund (accountant-fund payments don't count).
    prisma.pettyCash.aggregate({ where: { ...f, paymentMethod: 'CASH', paymentStatus: 'PAID', pettyType: 'CASHIER' }, _sum: { amount: true } }),
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
  // Cashiers are strictly locked to their own outlet.
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const dateParam = searchParams.get('date')

  // Single-day computed view (for the reconciliation form)
  if (dateParam) {
    const parsed = parse(dateParam, 'yyyy-MM-dd', new Date())
    const day = isValid(parsed) ? parsed : new Date()
    const computed = await computeCash(startOfDay(day), endOfDay(day), outletId)
    const existing = await prisma.cashRecon.findFirst({
      where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, ...(outletId ? { outletId } : {}) },
    })
    const autoOpening = await previousClosing(day, outletId)
    return NextResponse.json({ computed, existing, autoOpening, canVerify: await canVerifyCash(user.email) })
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
  const { date, outletId, cashDeposited = 0, notes } = body
  const day = date ? new Date(date) : new Date()
  // Cashiers always reconcile their own outlet.
  const usedOutletId = writeOutletId(user, outletId)

  // Opening = previous closing (auto). Closing computed & stored.
  const opening = await previousClosing(day, usedOutletId)
  const c = await computeCash(startOfDay(day), endOfDay(day), usedOutletId)
  const deposited = roundMoney(cashDeposited)
  const closing = roundMoney(opening + c.cashCollected + c.paidBillsCash - c.cashExpenses - deposited)

  // One reconciliation per day+outlet — update if it exists
  const existing = await prisma.cashRecon.findFirst({
    where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, outletId: usedOutletId },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {
    date: day,
    outletId: usedOutletId,
    openingBalance: opening,
    cashDeposited: deposited,
    closingBalance: closing,
    notes: notes || null,
    cashierId: user.userId,
  }
  // Verified amount: only an authorized officer may set/change it.
  if (body.verifiedAmount !== undefined && body.verifiedAmount !== null && body.verifiedAmount !== '') {
    if (await canVerifyCash(user.email)) {
      data.verifiedAmount = roundMoney(body.verifiedAmount)
      data.verifiedBy = user.name
    } else {
      return NextResponse.json({ error: 'Only an authorized officer can enter the verified cash amount' }, { status: 403 })
    }
  }

  const item = existing
    ? await prisma.cashRecon.update({ where: { id: existing.id }, data })
    : await prisma.cashRecon.create({ data })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: existing ? 'UPDATE' : 'CREATE', entity: 'CashRecon', entityId: item.id, details: `Deposited ${deposited}, closing ${closing}` },
  })

  return NextResponse.json(item, { status: 201 })
}
