import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { startStockCount } from '@/lib/stock'

/**
 * POST /api/inventory/stock-counts
 * body: { scope?, outletId?, counterCode?, warehouseId? }
 * scope defaults to COUNTER_DAILY (outletId+counterCode required) or pass
 * scope: 'STORE_MONTHLY' with warehouseId. Starts (or resumes) today's
 * stock count — see lib/stock.ts's startStockCount.
 */
export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { scope, outletId, counterCode, warehouseId } = await req.json().catch(() => ({}))
  const resolvedScope = scope === 'STORE_MONTHLY' ? 'STORE_MONTHLY' : 'COUNTER_DAILY'
  if (resolvedScope === 'STORE_MONTHLY' && !warehouseId) {
    return NextResponse.json({ error: 'warehouseId is required for a STORE_MONTHLY count' }, { status: 400 })
  }
  if (resolvedScope === 'COUNTER_DAILY' && (!outletId || !counterCode)) {
    return NextResponse.json({ error: 'outletId and counterCode are required for a COUNTER_DAILY count' }, { status: 400 })
  }

  try {
    const result = await startStockCount({ scope: resolvedScope, outletId, counterCode, warehouseId, userId: payload.userId })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stock count failed' }, { status: 400 })
  }
}

/**
 * GET /api/inventory/stock-counts?outletId=&counterCode=
 * GET /api/inventory/stock-counts?scope=STORE_MONTHLY&warehouseId=
 * List past sessions, most recent first.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outletId = req.nextUrl.searchParams.get('outletId')
  const counterCode = req.nextUrl.searchParams.get('counterCode')
  const warehouseId = req.nextUrl.searchParams.get('warehouseId')
  if (!outletId && !warehouseId) return NextResponse.json({ error: 'outletId or warehouseId required' }, { status: 400 })

  const sessions = await prisma.stockCountSession.findMany({
    where: warehouseId ? { warehouseId } : { outletId, ...(counterCode ? { counterCode } : {}) },
    orderBy: { countDate: 'desc' },
    take: 100,
  })

  return NextResponse.json({ rows: sessions })
}
