import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/** List cancellations with their staff (via collection), product and status. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')

  const items = await prisma.cancellation.findMany({
    where: outletId ? { outletId } : {},
    include: { collection: { select: { staffName: true, outlet: { select: { name: true } } } } },
    orderBy: { date: 'desc' },
    take: 500,
  })

  const rows = items.map((c) => ({
    id: c.id, date: c.date, reason: c.reason, productName: c.productName,
    sellingPrice: c.sellingPrice, quantity: c.quantity, amount: c.amount,
    status: c.status, approvedBy: c.approvedBy || '',
    staffName: c.collection?.staffName || '(Unassigned)',
    outletName: c.collection?.outlet?.name || '',
  }))
  return NextResponse.json(rows)
}
