import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { restockCounter } from '@/lib/stock'

/**
 * POST /api/inventory/stock-levels/restock
 * body: { productId, outletId, counterCode, quantity, note? }
 * Manual Adjustment — for stock arriving directly at a counter outside the
 * normal Main Store → Transfer flow (see /api/inventory/transfers).
 */
export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { productId, outletId, counterCode, quantity, note } = await req.json().catch(() => ({}))
  if (!productId || !outletId || !counterCode) {
    return NextResponse.json({ error: 'productId, outletId and counterCode are required' }, { status: 400 })
  }
  const qty = Number(quantity)
  if (!Number.isFinite(qty) || qty <= 0) {
    return NextResponse.json({ error: 'quantity must be a positive number' }, { status: 400 })
  }

  try {
    const result = await restockCounter({
      productId, outletId, counterCode, quantity: qty,
      note: typeof note === 'string' ? note.trim().slice(0, 300) || undefined : undefined,
      userId: payload.userId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Restock failed' }, { status: 400 })
  }
}
