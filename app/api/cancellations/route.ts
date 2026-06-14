import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
// Accounts allowed to file a standalone cancellation request.
const CANCEL_REQUESTERS = ['alphonce.mvungi@tips.co.tz']
function canRequestCancellation(role: string, email?: string) {
  const e = (email || '').toLowerCase()
  return role === 'CASHIER' || CANCEL_REQUESTERS.includes(e) || (!!OWNER_EMAIL && e === OWNER_EMAIL)
}

/** List cancellations with their staff (via collection or direct), product and status. */
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
    staffName: c.staffName || c.collection?.staffName || '(Unassigned)',
    outletName: c.collection?.outlet?.name || '',
  }))
  return NextResponse.json(rows)
}

/** File a standalone cancellation request — cashiers + the designated manager. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canRequestCancellation(user.role, user.email)) {
    return NextResponse.json({ error: 'You are not authorized to file cancellation requests' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { staffName, productId, productName, sellingPrice, quantity, reason, outletId, date } = body
  const qty = Number(quantity) || 0
  const price = roundMoney(sellingPrice)
  if (!productName) return NextResponse.json({ error: 'Product is required' }, { status: 400 })
  if (qty <= 0) return NextResponse.json({ error: 'Quantity must be > 0' }, { status: 400 })

  const item = await prisma.cancellation.create({
    data: {
      reason: reason || 'Double Punch',
      staffName: staffName || null,
      productId: productId || null,
      productName,
      sellingPrice: price,
      quantity: qty,
      amount: roundMoney(price * qty),
      status: 'PENDING',
      outletId: outletId || user.outletId || null,
      cashierId: user.userId,
      date: date ? new Date(date) : new Date(),
    },
  })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'Cancellation', entityId: item.id, details: `Cancellation request: ${productName} x${qty}` } })
  return NextResponse.json(item, { status: 201 })
}
