import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { roundMoney } from '@/lib/utils'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id: orderId } = await params
  const { productId, quantity = 1, extras = [], counterCode } = await req.json()
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  const order = await prisma.posOrder.findUnique({ where: { id: orderId } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status === 'CLOSED' || order.status === 'CANCELLED')
    return NextResponse.json({ error: 'Order is closed' }, { status: 400 })

  const product = await prisma.product.findUnique({ where: { id: productId } })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  const qty = Number(quantity)
  const amount = roundMoney(product.sellingPrice * qty)

  const item = await prisma.posOrderItem.create({
    data: {
      orderId,
      productId,
      productName: product.name,
      unitPrice: product.sellingPrice,
      quantity: qty,
      amount,
      extras: extras.length ? JSON.stringify(extras) : null,
      counterCode: counterCode ?? null,
    },
  })

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
