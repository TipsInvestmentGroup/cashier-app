import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  const code = req.nextUrl.searchParams.get('code')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const items = await prisma.posOrderItem.findMany({
    where: {
      order: { outletId, status: { in: ['OPEN', 'SENT'] } },
      status: 'SENT',
      ...(code ? { counterCode: code } : {}),
    },
    include: {
      order: {
        select: {
          orderNo: true,
          table: { select: { number: true, label: true } },
          waiter: { select: { name: true } },
        },
      },
    },
    orderBy: { sentAt: 'asc' },
  })

  return NextResponse.json(items)
}
