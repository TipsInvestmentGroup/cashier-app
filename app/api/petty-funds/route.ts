import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageFunds } from '@/lib/petty-access'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** List accountant petty-cash funds with computed current balance and recent txns. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const funds = await db.pettyFund.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    include: { txns: { orderBy: { createdAt: 'desc' }, take: 50 } },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = funds.map((f: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const moves = f.txns as any[]
    const replenished = roundMoney(moves.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0))
    const paidOut = roundMoney(Math.abs(moves.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0)))
    const balance = roundMoney((f.openingBalance || 0) + moves.reduce((s, t) => s + t.amount, 0))
    return {
      id: f.id, name: f.name, ownerName: f.ownerName, outletId: f.outletId, depositDate: f.depositDate,
      openingBalance: roundMoney(f.openingBalance || 0), replenished, paidOut, balance,
      txns: moves.map((t) => ({ id: t.id, type: t.type, amount: t.amount, note: t.note, createdByName: t.createdByName, createdAt: t.createdAt })),
    }
  })

  return NextResponse.json(rows)
}

/**
 * Create an accountant petty-cash fund. body: { openingBalance, depositDate?, outletId? }
 * The operating accountant is taken from the logged-in user (not the request body),
 * and the fund name is derived automatically from the deposit date.
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canManageFunds(user.role)) return NextResponse.json({ error: 'Only an accountant or admin can create a fund' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const openingBalance = roundMoney(body.openingBalance || 0)
  if (!(openingBalance > 0)) return NextResponse.json({ error: 'Enter the amount deposited as petty cash' }, { status: 400 })

  const depositDate = body.depositDate ? new Date(body.depositDate) : new Date()
  if (isNaN(depositDate.getTime())) return NextResponse.json({ error: 'Invalid deposit date' }, { status: 400 })
  const dateLabel = depositDate.toISOString().slice(0, 10)
  const name = `Petty Cash — ${dateLabel}`

  const fund = await db.pettyFund.create({
    data: {
      name,
      ownerName: user.name,        // auto-filled from the logged-in accountant
      ownerId: user.userId,
      outletId: body.outletId || null,
      openingBalance,
      depositDate,
    },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'PettyFund', entityId: fund.id, details: `Deposited ${openingBalance} petty cash on ${dateLabel}` },
  })

  return NextResponse.json(fund, { status: 201 })
}
