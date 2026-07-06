import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { issueTransfer } from '@/lib/stock'

/**
 * POST /api/inventory/transfers
 * body: { warehouseId, outletId, counterCode, note?, items: [{ productId, quantity }] }
 * Single atomic Main Store -> Counter stock movement (see lib/stock.ts's
 * issueTransfer) — no separate request/approve/receive steps.
 */
export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { warehouseId, outletId, counterCode, note, items } = await req.json().catch(() => ({}))
  if (!warehouseId || !outletId || !counterCode) {
    return NextResponse.json({ error: 'warehouseId, outletId and counterCode are required' }, { status: 400 })
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
  }

  const parsedItems: Array<{ productId: string; quantity: number }> = []
  for (const item of items) {
    const quantity = Number(item?.quantity)
    if (!item?.productId) return NextResponse.json({ error: 'Each item needs a productId' }, { status: 400 })
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: 'Each item needs a positive quantity' }, { status: 400 })
    }
    parsedItems.push({ productId: item.productId, quantity })
  }

  try {
    const result = await issueTransfer({
      warehouseId, outletId, counterCode,
      note: typeof note === 'string' ? note.trim().slice(0, 300) || undefined : undefined,
      items: parsedItems, userId: payload.userId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Transfer failed' }, { status: 400 })
  }
}

/**
 * GET /api/inventory/transfers?warehouseId=&outletId=&counterCode=
 * Recent transfers, most recent first.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const warehouseId = req.nextUrl.searchParams.get('warehouseId')
  const outletId = req.nextUrl.searchParams.get('outletId')
  const counterCode = req.nextUrl.searchParams.get('counterCode')

  const transfers = await prisma.stockTransfer.findMany({
    where: {
      ...(warehouseId ? { warehouseId } : {}),
      ...(outletId ? { outletId } : {}),
      ...(counterCode ? { counterCode } : {}),
    },
    include: { items: { select: { quantity: true } }, outlet: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({
    rows: transfers.map((t) => ({
      id: t.id, transferNumber: t.transferNumber, outletId: t.outletId, outletName: t.outlet.name,
      counterCode: t.counterCode, note: t.note, itemCount: t.items.length,
      totalQuantity: t.items.reduce((sum, i) => sum + i.quantity, 0), createdAt: t.createdAt,
    })),
  })
}
