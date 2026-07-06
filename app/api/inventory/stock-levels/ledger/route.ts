import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'

/**
 * GET /api/inventory/stock-levels/ledger?outletId=&counterCode=&productId=
 * GET /api/inventory/stock-levels/ledger?warehouseId=&productId=
 * Recent stock movements for the history view, most recent first. Accepts
 * either a counter (outletId, optional counterCode) or a warehouseId.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outletId = req.nextUrl.searchParams.get('outletId')
  const counterCode = req.nextUrl.searchParams.get('counterCode')
  const warehouseId = req.nextUrl.searchParams.get('warehouseId')
  const productId = req.nextUrl.searchParams.get('productId')
  if (!outletId && !warehouseId) return NextResponse.json({ error: 'outletId or warehouseId required' }, { status: 400 })

  const entries = await prisma.stockLedgerEntry.findMany({
    where: {
      ...(warehouseId ? { warehouseId } : { outletId, ...(counterCode ? { counterCode } : {}) }),
      ...(productId ? { productId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({ rows: entries })
}
