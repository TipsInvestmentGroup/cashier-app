import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { canActOnOrder } from '@/lib/pos-close'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const order = await prisma.posOrder.findUnique({
    where: { id },
    include: {
      table: { select: { number: true, label: true } },
      waiter: { select: { name: true } },
      shift: { select: { name: true } },
      outlet: { select: { name: true, legalName: true, tin: true, vrn: true } },
      payments: { orderBy: { createdAt: 'asc' } },
      items: {
        where: { status: { not: 'CANCELLED' } },
        include: { product: { select: { id: true, name: true, code: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!order) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // preparedBy is a plain userId (no relation on PosOrderItem) — resolve to a
  // display name here so the client's order-history view doesn't need a
  // separate round-trip per item.
  const preparedByIds = [...new Set(order.items.map((i) => i.preparedBy).filter((v): v is string => !!v))]
  const preparers = preparedByIds.length
    ? await prisma.user.findMany({ where: { id: { in: preparedByIds } }, select: { id: true, name: true } })
    : []
  const preparerNames = new Map(preparers.map((p) => [p.id, p.name]))
  const itemsWithPreparer = order.items.map((i) => ({ ...i, preparedByName: i.preparedBy ? preparerNames.get(i.preparedBy) ?? null : null }))

  return NextResponse.json({ ...order, items: itemsWithPreparer })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.posOrder.findUnique({ where: { id }, select: { outletId: true } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!canActOnOrder(payload, existing)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()

  const BILL_TYPES = ['CUSTOMER', 'ADMIN', 'DIRECTOR', 'DJ', 'TIPS', 'STAFF']
  const allowedFields: Record<string, unknown> = {}
  if (body.discount !== undefined) allowedFields.discount = Number(body.discount)
  if (body.notes !== undefined) allowedFields.notes = body.notes
  if (body.paymentMethod !== undefined) allowedFields.paymentMethod = body.paymentMethod
  if (body.billType !== undefined && BILL_TYPES.includes(body.billType)) allowedFields.billType = body.billType

  const order = await prisma.posOrder.update({ where: { id }, data: allowedFields })
  return NextResponse.json(order)
}
