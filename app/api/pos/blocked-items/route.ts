import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

// GET /api/pos/blocked-items?outletId=xxx — list blocked products for an outlet
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const blocked = await db.posBlockedItem.findMany({
    where: { outletId },
    include: { product: { select: { id: true, name: true, code: true, category: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(blocked)
}

// POST /api/pos/blocked-items — block a product
export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!['MANAGER', 'ADMIN'].includes(payload.role))
    return NextResponse.json({ error: 'Forbidden — managers only' }, { status: 403 })

  const { productId, reason, outletId: bodyOutletId } = await req.json()
  if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

  const outletId = payload.outletId ?? bodyOutletId
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const item = await db.posBlockedItem.upsert({
    where: { outletId_productId: { outletId, productId } },
    update: { blockedBy: payload.userId, reason: reason ?? null },
    create: { outletId, productId, blockedBy: payload.userId, reason: reason ?? null },
  })
  return NextResponse.json(item, { status: 201 })
}

// DELETE /api/pos/blocked-items?productId=xxx — unblock a product
export async function DELETE(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!['MANAGER', 'ADMIN'].includes(payload.role))
    return NextResponse.json({ error: 'Forbidden — managers only' }, { status: 403 })

  const productId = req.nextUrl.searchParams.get('productId')
  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  if (!productId || !outletId) return NextResponse.json({ error: 'productId and outletId required' }, { status: 400 })

  await db.posBlockedItem.deleteMany({ where: { outletId, productId } })
  return NextResponse.json({ ok: true })
}
