import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'
import { allowedCountersForCategory } from '@/lib/shared-constants'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: orderId } = await params
  const { productId, quantity = 1, extras = [], counterCode, clientRequestId } = await req.json()
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  // Offline-queue retry: if this exact item was already added (the first
  // attempt succeeded server-side but its response never reached the client
  // before the connection dropped again), return it instead of adding a
  // duplicate line item.
  if (clientRequestId) {
    const existingByKey = await prisma.posOrderItem.findUnique({ where: { clientRequestId } })
    if (existingByKey) {
      const items = await prisma.posOrderItem.findMany({ where: { orderId, status: { not: 'CANCELLED' } }, select: { amount: true } })
      const totalAmount = roundMoney(items.reduce((s: number, i: { amount: number }) => s + i.amount, 0))
      return NextResponse.json({ item: existingByKey, totalAmount })
    }
  }

  const order = await prisma.posOrder.findUnique({ where: { id: orderId } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status === 'CLOSED' || order.status === 'CANCELLED')
    return NextResponse.json({ error: 'Order is closed' }, { status: 400 })

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // Shisha products only go to the Shisha counter, food only to Kitchen —
  // everything else (drinks, cigarettes, etc.) only to VIP/Main/Bar. Client
  // already filters the counter picker by this, but enforce it here too
  // since counterCode arrives as plain client input.
  if (counterCode && !allowedCountersForCategory(product.category).includes(counterCode)) {
    return NextResponse.json({ error: `${product.name} cannot be sent to counter ${counterCode}` }, { status: 400 })
  }

  const qty = Number(quantity)
  const amount = roundMoney(product.sellingPrice * qty)

  let item
  try {
    item = await prisma.posOrderItem.create({
      data: {
        orderId,
        productId,
        productName: product.name,
        unitPrice: product.sellingPrice,
        quantity: qty,
        amount,
        extras: extras.length ? JSON.stringify(extras) : null,
        counterCode: counterCode ?? null,
        clientRequestId: clientRequestId ?? null,
      },
    })
  } catch (err) {
    // clientRequestId collision — a concurrent request already created this
    // exact item (the pre-check above missed it in a tight race).
    if (clientRequestId && err instanceof Error && err.message.includes('clientRequestId')) {
      const existingByKey = await prisma.posOrderItem.findUnique({ where: { clientRequestId } })
      if (existingByKey) item = existingByKey
      else throw err
    } else {
      throw err
    }
  }

  const items = await prisma.posOrderItem.findMany({
    where: { orderId, status: { not: 'CANCELLED' } },
    select: { amount: true },
  })
  const totalAmount = roundMoney(items.reduce((s: number, i: { amount: number }) => s + i.amount, 0))
  await prisma.posOrder.update({ where: { id: orderId }, data: { totalAmount } })

  return NextResponse.json({ item, totalAmount }, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: orderId } = await params
  const itemId = req.nextUrl.searchParams.get('itemId')
  if (!itemId) return NextResponse.json({ error: 'itemId required' }, { status: 400 })

  await prisma.posOrderItem.update({
    where: { id: itemId },
    data: { status: 'CANCELLED', cancelledBy: payload.userId },
  })

  const items = await prisma.posOrderItem.findMany({
    where: { orderId, status: { not: 'CANCELLED' } },
    select: { amount: true },
  })
  const totalAmount = roundMoney(items.reduce((s: number, i: { amount: number }) => s + i.amount, 0))
  await prisma.posOrder.update({ where: { id: orderId }, data: { totalAmount } })

  return NextResponse.json({ ok: true, totalAmount })
}
