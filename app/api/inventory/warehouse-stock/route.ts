import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'

/**
 * GET /api/inventory/warehouse-stock?warehouseId=
 * Main Store's current stock — mirrors GET /api/inventory/stock-levels's
 * response shape, but keyed by warehouseId instead of outletId+counterCode.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const warehouseId = req.nextUrl.searchParams.get('warehouseId')
  if (!warehouseId) return NextResponse.json({ error: 'warehouseId required' }, { status: 400 })

  const levels = await prisma.stockLevel.findMany({
    where: { warehouseId },
    include: { product: { select: { name: true, category: true, trackingMode: true, gramsPerServing: true } } },
    orderBy: { product: { name: 'asc' } },
  })

  return NextResponse.json({
    rows: levels.map((l) => ({
      id: l.id, productId: l.productId, productName: l.product.name, category: l.product.category,
      quantity: l.quantity, trackingMode: l.product.trackingMode,
      gramsPerServing: l.product.gramsPerServing, updatedAt: l.updatedAt,
    })),
  })
}
