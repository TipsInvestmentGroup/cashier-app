import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const orders = await prisma.posOrder.findMany({
    where: { outletId, status: { in: ['OPEN', 'SENT', 'READY'] } },
    include: {
      table: { select: { number: true, label: true } },
      waiter: { select: { name: true } },
      items: {
        where: { status: { not: 'CANCELLED' } },
        select: { id: true, productName: true, quantity: true, amount: true, status: true, counterCode: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(orders)
}

export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { tableId, shiftId, outletId: bodyOutletId } = await req.json()
  if (!shiftId) return NextResponse.json({ error: 'shiftId required' }, { status: 400 })

  const outletId = payload.outletId ?? bodyOutletId
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  // If table already has an open order, return it
  if (tableId) {
    const existing = await prisma.posOrder.findFirst({
      where: { tableId, status: { in: ['OPEN', 'SENT', 'READY'] } },
    })
    if (existing) return NextResponse.json(existing)
  }

  const today = new Date()
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '')
  const count = await prisma.posOrder.count({
    where: { outletId, createdAt: { gte: new Date(today.toDateString()) } },
  })
  const orderNo = `ORD-${dateStr}-${String(count + 1).padStart(3, '0')}`

  const order = await prisma.posOrder.create({
    data: { orderNo, outletId, tableId: tableId ?? null, shiftId, waiterId: payload.userId },
  })
  return NextResponse.json(order, { status: 201 })
}
