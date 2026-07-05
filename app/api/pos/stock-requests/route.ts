import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendPushToUser } from '@/lib/push'
import { STOCK_REQUEST_ROUTES, SUPPLIER_POSITION } from '@/lib/shared-constants'

/**
 * GET /api/pos/stock-requests?outletId=&status=&fromCounter=&toCounter=
 * Lists stock-transfer requests — the requesting counter uses fromCounter to
 * see its own pending asks, the supplying counter uses toCounter to see what
 * it needs to fulfil.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })
  const status = req.nextUrl.searchParams.get('status')
  const fromCounter = req.nextUrl.searchParams.get('fromCounter')
  const toCounter = req.nextUrl.searchParams.get('toCounter')

  const requests = await prisma.posStockRequest.findMany({
    where: {
      outletId,
      ...(status ? { status } : {}),
      ...(fromCounter ? { fromCounter } : {}),
      ...(toCounter ? { toCounter } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(requests)
}

/**
 * POST /api/pos/stock-requests — a counter out of stock asks another counter
 * to supply a product (e.g. VIP asking the Main Drinks Counter). Which
 * counter can ask which is fixed by the requester's position — see
 * STOCK_REQUEST_ROUTES. body: { productName, note? }
 */
export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const route = payload.position ? STOCK_REQUEST_ROUTES[payload.position] : undefined
  if (!route) return NextResponse.json({ error: 'Your position cannot request stock' }, { status: 403 })

  const outletId = payload.outletId
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const { productName, note } = await req.json().catch(() => ({}))
  if (!productName || typeof productName !== 'string' || !productName.trim()) {
    return NextResponse.json({ error: 'productName required' }, { status: 400 })
  }

  const request = await prisma.posStockRequest.create({
    data: {
      outletId,
      fromCounter: route.from,
      toCounter: route.to,
      productName: productName.trim().slice(0, 200),
      note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : null,
      requestedById: payload.userId,
      requestedByName: payload.name,
    },
  })

  const supplierPosition = SUPPLIER_POSITION[route.to]
  if (supplierPosition) {
    const suppliers = await prisma.user.findMany({
      where: { outletId, isActive: true, position: supplierPosition },
      select: { id: true },
    })
    // Best-effort — never block the request on push delivery.
    await Promise.all(suppliers.map((s) =>
      sendPushToUser(s.id, {
        title: '🔄 Ombi la bidhaa',
        body: `${request.fromCounter} inaomba: ${request.productName}`,
        url: '/pos/counter',
      }).catch((err) => console.error('[push] stock request notify failed for', s.id, err))
    ))
  }

  return NextResponse.json(request, { status: 201 })
}
