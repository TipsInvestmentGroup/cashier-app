import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/** List Customer signed bills (requests) with staff, customer and approval status. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')

  const items = await prisma.signedBill.findMany({
    where: { billType: 'CUSTOMER', ...(outletId ? { outletId } : {}) },
    include: { outlet: { select: { name: true } }, items: { select: { productName: true, quantity: true, amount: true } } },
    orderBy: { date: 'desc' },
    take: 500,
  })

  const rows = items.map((b) => ({
    id: b.id, date: b.date, personName: b.personName,
    serviceStaff: b.serviceStaff || '(Unassigned)', amount: b.amount,
    status: b.approvalStatus, approvedBy: b.approvedBy || '', outletName: b.outlet?.name || '',
    description: b.description || '', items: b.items,
  }))
  return NextResponse.json(rows)
}
