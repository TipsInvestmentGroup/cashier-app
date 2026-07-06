import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { startStockCount } from '@/lib/stock'

/**
 * POST /api/inventory/stock-counts
 * body: { outletId, counterCode }
 * Starts (or resumes) today's stock count for a counter — see
 * lib/stock.ts's startStockCount.
 */
export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { outletId, counterCode } = await req.json().catch(() => ({}))
  if (!outletId || !counterCode) return NextResponse.json({ error: 'outletId and counterCode are required' }, { status: 400 })

  try {
    const result = await startStockCount({ outletId, counterCode, userId: payload.userId })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stock count failed' }, { status: 400 })
  }
}

/**
 * GET /api/inventory/stock-counts?outletId=&counterCode=
 * List past sessions, most recent first.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outletId = req.nextUrl.searchParams.get('outletId')
  const counterCode = req.nextUrl.searchParams.get('counterCode')
  if (!outletId) return NextResponse.json({ error: 'outletId required' }, { status: 400 })

  const sessions = await prisma.stockCountSession.findMany({
    where: { outletId, ...(counterCode ? { counterCode } : {}) },
    orderBy: { countDate: 'desc' },
    take: 100,
  })

  return NextResponse.json({ rows: sessions })
}
