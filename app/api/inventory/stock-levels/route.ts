import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'

/**
 * GET /api/inventory/stock-levels?outletId=&counterCode=
 * Current counter stock — only rows a manager has actually restocked at
 * least once show up (see lib/stock.ts's opt-in tracking design).
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outletId = req.nextUrl.searchParams.get('outletId')
  const counterCode = req.nextUrl.searchParams.get('counterCode')
  if (!outletId) return NextResponse.json({ error: 'outletId required' }, { status: 400 })

  const levels = await prisma.stockLevel.findMany({
    where: { outletId, ...(counterCode ? { counterCode } : {}) },
    include: { product: { select: { name: true, category: true, trackingMode: true, gramsPerServing: true } } },
    orderBy: { product: { name: 'asc' } },
  })

  return NextResponse.json({
    rows: levels.map((l) => ({
      id: l.id, productId: l.productId, productName: l.product.name, category: l.product.category,
      counterCode: l.counterCode, quantity: l.quantity, trackingMode: l.product.trackingMode,
      gramsPerServing: l.product.gramsPerServing, updatedAt: l.updatedAt,
    })),
  })
}
