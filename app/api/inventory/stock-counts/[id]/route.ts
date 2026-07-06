import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { submitStockCount } from '@/lib/stock'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/inventory/stock-counts/[id]
 * Full detail: items + attributions.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const session = await prisma.stockCountSession.findUnique({
    where: { id },
    include: { items: true, attributions: true },
  })
  if (!session) return NextResponse.json({ error: 'Stock count session not found' }, { status: 404 })

  return NextResponse.json({ session })
}

/**
 * PATCH /api/inventory/stock-counts/[id]
 * body: { items: [{ id, closingPhysical, discountQty?, breakageQty? }] }
 * Finalizes the count — see lib/stock.ts's submitStockCount.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { items } = await req.json().catch(() => ({}))
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
  }

  const parsedItems: Array<{ id: string; closingPhysical: number; discountQty?: number; breakageQty?: number }> = []
  for (const item of items) {
    const closingPhysical = Number(item?.closingPhysical)
    if (!item?.id || !Number.isFinite(closingPhysical) || closingPhysical < 0) {
      return NextResponse.json({ error: 'Each item needs an id and a non-negative closingPhysical' }, { status: 400 })
    }
    const discountQty = item.discountQty === undefined || item.discountQty === null || item.discountQty === '' ? undefined : Number(item.discountQty)
    const breakageQty = item.breakageQty === undefined || item.breakageQty === null || item.breakageQty === '' ? undefined : Number(item.breakageQty)
    if (discountQty !== undefined && (!Number.isFinite(discountQty) || discountQty < 0)) {
      return NextResponse.json({ error: 'discountQty must be a non-negative number' }, { status: 400 })
    }
    if (breakageQty !== undefined && (!Number.isFinite(breakageQty) || breakageQty < 0)) {
      return NextResponse.json({ error: 'breakageQty must be a non-negative number' }, { status: 400 })
    }
    parsedItems.push({ id: item.id, closingPhysical, discountQty, breakageQty })
  }

  try {
    const result = await submitStockCount({ sessionId: id, items: parsedItems, userId: payload.userId })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Submit failed' }, { status: 400 })
  }
}
