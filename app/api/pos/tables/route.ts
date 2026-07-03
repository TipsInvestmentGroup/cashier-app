import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const tables = await prisma.posTable.findMany({
    where: { outletId, isActive: true },
    orderBy: { number: 'asc' },
    include: {
      orders: {
        where: { status: { in: ['OPEN', 'SENT', 'READY'] } },
        select: {
          id: true, orderNo: true, status: true, totalAmount: true,
          waiterId: true, waiter: { select: { name: true } },
        },
        take: 1,
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  return NextResponse.json(tables)
}
