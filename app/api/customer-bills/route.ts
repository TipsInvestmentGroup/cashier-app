import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canFileRequest } from '@/lib/request-access'
import { createBillRequest } from '@/lib/bill-request'

/** List Customer signed bills (requests) with staff, customer and approval status. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = user.role === 'CASHIER' ? user.outletId : searchParams.get('outletId')

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

/** File a Customer bill request — cashiers + the designated manager. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canFileRequest(user.role, user.email)) return NextResponse.json({ error: 'You are not authorized to file customer bill requests' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const usedOutletId = body.outletId || user.outletId
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })
  if (!body.personName) return NextResponse.json({ error: 'Customer name is required' }, { status: 400 })

  const bill = await createBillRequest({
    billType: 'CUSTOMER', personName: body.personName, serviceStaff: body.serviceStaff,
    amount: body.amount, items: body.items, outletId: usedOutletId, cashierId: user.userId, date: body.date,
  })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'SignedBill', entityId: bill.id, details: `Customer bill request for ${body.personName}` } })
  return NextResponse.json(bill, { status: 201 })
}
