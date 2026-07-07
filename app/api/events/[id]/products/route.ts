import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** POST /api/events/[id]/products — authorize a catalog product for sale at this event. body: { productId, eventPrice?, expectedQuantity?, procurementQuantity? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 })

  const product = await db.product.findUnique({ where: { id: body.productId } })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const dupe = await db.eventProduct.findFirst({ where: { eventId: id, productId: product.id } })
  if (dupe) return NextResponse.json({ error: `${product.name} is already authorized for this event` }, { status: 409 })

  const item = await db.eventProduct.create({
    data: {
      eventId: id,
      productId: product.id,
      productName: product.name,
      eventPrice: body.eventPrice !== undefined && body.eventPrice !== '' ? roundMoney(Number(body.eventPrice)) : null,
      expectedQuantity: Math.max(0, Number(body.expectedQuantity) || 0),
      procurementQuantity: Math.max(0, Number(body.procurementQuantity) || 0),
    },
    include: { product: { select: { category: true, sellingPrice: true, unitMeasure: true } } },
  })
  return NextResponse.json(item, { status: 201 })
}

/** PATCH /api/events/[id]/products — update planning/stock numbers. body: { eventProductId, ...fields } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const body = await req.json().catch(() => ({}))
  if (!body.eventProductId) return NextResponse.json({ error: 'eventProductId is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.eventPrice !== undefined) data.eventPrice = body.eventPrice === '' || body.eventPrice === null ? null : roundMoney(Number(body.eventPrice))
  if (body.expectedQuantity !== undefined) data.expectedQuantity = Math.max(0, Number(body.expectedQuantity) || 0)
  if (body.procurementQuantity !== undefined) data.procurementQuantity = Math.max(0, Number(body.procurementQuantity) || 0)
  if (body.stockAllocated !== undefined) data.stockAllocated = Math.max(0, Number(body.stockAllocated) || 0)
  if (body.stockReturned !== undefined) data.stockReturned = Math.max(0, Number(body.stockReturned) || 0)
  if (body.quantitySold !== undefined) data.quantitySold = Math.max(0, Number(body.quantitySold) || 0)

  const item = await db.eventProduct.update({ where: { id: body.eventProductId }, data })
  return NextResponse.json(item)
}

/** DELETE /api/events/[id]/products?eventProductId= */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const eventProductId = new URL(req.url).searchParams.get('eventProductId')
  if (!eventProductId) return NextResponse.json({ error: 'eventProductId required' }, { status: 400 })
  await db.eventProduct.delete({ where: { id: eventProductId } })
  return NextResponse.json({ ok: true })
}
