import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { reportBreakage } from '@/lib/stock'

const VALID_REASONS = ['BROKEN', 'EXPIRED', 'DAMAGED', 'LOST']

/**
 * POST /api/inventory/breakage
 * body: { productId, quantity, reason, outletId?, counterCode?, warehouseId?, note?, photoUrl? }
 * Deducts stock immediately — see lib/stock.ts's reportBreakage.
 */
export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { productId, quantity, reason, outletId, counterCode, warehouseId, note, photoUrl } = await req.json().catch(() => ({}))
  const parsedQuantity = Number(quantity)
  if (!productId || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
    return NextResponse.json({ error: 'productId and a positive quantity are required' }, { status: 400 })
  }
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })
  }
  if (!warehouseId && !(outletId && counterCode)) {
    return NextResponse.json({ error: 'Either warehouseId, or outletId+counterCode, is required' }, { status: 400 })
  }

  try {
    const result = await reportBreakage({
      productId, quantity: parsedQuantity, reason,
      outletId: outletId || undefined, counterCode: counterCode || undefined, warehouseId: warehouseId || undefined,
      note: typeof note === 'string' ? note.trim().slice(0, 300) || undefined : undefined,
      photoUrl: typeof photoUrl === 'string' ? photoUrl.trim().slice(0, 500) || undefined : undefined,
      userId: payload.userId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to report breakage' }, { status: 400 })
  }
}

/**
 * GET /api/inventory/breakage?outletId=&counterCode=&warehouseId=
 * History, most recent first.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outletId = req.nextUrl.searchParams.get('outletId')
  const counterCode = req.nextUrl.searchParams.get('counterCode')
  const warehouseId = req.nextUrl.searchParams.get('warehouseId')
  if (!outletId && !warehouseId) return NextResponse.json({ error: 'outletId or warehouseId required' }, { status: 400 })

  const rows = await prisma.breakage.findMany({
    where: warehouseId ? { warehouseId } : { outletId, ...(counterCode ? { counterCode } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({ rows })
}
