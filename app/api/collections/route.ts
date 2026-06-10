import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId') || user.outletId
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const where: Record<string, unknown> = {}
  if (outletId && user.role !== 'ADMIN' && user.role !== 'DIRECTOR') {
    where.outletId = outletId
  } else if (outletId) {
    where.outletId = outletId
  }
  if (startDate && endDate) {
    where.date = { gte: new Date(startDate), lte: new Date(endDate) }
  }

  const collections = await prisma.dailyCollection.findMany({
    where,
    include: { outlet: true, cashier: { select: { name: true } } },
    orderBy: { date: 'desc' },
    take: 100,
  })

  return NextResponse.json(collections)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['CASHIER', 'ADMIN', 'ACCOUNTANT'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { cash = 0, crdb = 0, stanbic = 0, mpesa = 0, notes, outletId, date, staffName, systemSales = 0 } = body

  const total = Number(cash) + Number(crdb) + Number(stanbic) + Number(mpesa)
  const usedOutletId = outletId || user.outletId
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })

  const collection = await prisma.dailyCollection.create({
    data: {
      cash: Number(cash),
      crdb: Number(crdb),
      stanbic: Number(stanbic),
      mpesa: Number(mpesa),
      total,
      staffName: staffName || null,
      systemSales: Number(systemSales) || 0,
      notes,
      outletId: usedOutletId,
      cashierId: user.userId,
      date: date ? new Date(date) : new Date(),
    },
    include: { outlet: true },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'CREATE',
      entity: 'DailyCollection',
      entityId: collection.id,
      details: `Total: ${total}`,
    },
  })

  return NextResponse.json(collection, { status: 201 })
}
