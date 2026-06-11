import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']

/** Bank-channel collections (CRDB + Stanbic + M-PESA) for a day+outlet — the cashier-reported figure. */
async function computeBank(dayStart: Date, dayEnd: Date, outletId?: string | null) {
  const range = { gte: dayStart, lte: dayEnd }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = { date: range }
  if (outletId) f.outletId = outletId
  const [coll, paid] = await Promise.all([
    prisma.dailyCollection.aggregate({ where: f, _sum: { crdb: true, stanbic: true, mpesa: true } }),
    prisma.paidBill.aggregate({ where: { ...f, paymentMethod: { in: ['CRDB', 'STANBIC', 'MPESA'] } }, _sum: { amountPaid: true } }),
  ])
  const collBank = (coll._sum.crdb || 0) + (coll._sum.stanbic || 0) + (coll._sum.mpesa || 0)
  return { reported: collBank + (paid._sum.amountPaid || 0) }
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const dateParam = searchParams.get('date')

  if (dateParam) {
    const parsed = parse(dateParam, 'yyyy-MM-dd', new Date())
    const day = isValid(parsed) ? parsed : new Date()
    const computed = await computeBank(startOfDay(day), endOfDay(day), outletId)
    const existing = await prisma.bankRecon.findFirst({
      where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, ...(outletId ? { outletId } : {}) },
    })
    return NextResponse.json({ computed, existing })
  }

  const items = await prisma.bankRecon.findMany({ where: outletId ? { outletId } : {}, orderBy: { date: 'desc' }, take: 200 })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { date, outletId, reportedAmount = 0, verifiedAmount = 0, reason, reportedBy, verifiedBy } = body
  const day = date ? new Date(date) : new Date()
  const usedOutletId = outletId || user.outletId || null

  const existing = await prisma.bankRecon.findFirst({
    where: { date: { gte: startOfDay(day), lte: endOfDay(day) }, outletId: usedOutletId },
  })
  const data = {
    date: day,
    outletId: usedOutletId,
    reportedAmount: Number(reportedAmount) || 0,
    verifiedAmount: Number(verifiedAmount) || 0,
    reason: reason || null,
    reportedBy: reportedBy || null,
    verifiedBy: verifiedBy || null,
    cashierId: user.userId,
  }
  const item = existing
    ? await prisma.bankRecon.update({ where: { id: existing.id }, data })
    : await prisma.bankRecon.create({ data })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: existing ? 'UPDATE' : 'CREATE', entity: 'BankRecon', entityId: item.id, details: `Reported ${data.reportedAmount} / verified ${data.verifiedAmount}` },
  })

  return NextResponse.json(item, { status: 201 })
}
