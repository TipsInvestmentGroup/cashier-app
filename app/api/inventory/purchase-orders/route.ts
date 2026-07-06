import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { createPurchaseOrder } from '@/lib/stock'

/**
 * GET /api/inventory/purchase-orders?status=
 * POST /api/inventory/purchase-orders
 * body: { supplierId, outletIds: string[], expectedDate?, paymentTerms?, notes?, items: [{ productId, purchaseUnit, packSize, quantity, unitPrice }] }
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const status = req.nextUrl.searchParams.get('status')
  const orders = await prisma.purchaseOrder.findMany({
    where: { ...(status ? { status } : {}) },
    include: { supplier: { select: { name: true } }, items: { select: { amount: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({
    rows: orders.map((o) => ({
      id: o.id, poNumber: o.poNumber, supplierName: o.supplier.name, status: o.status,
      itemCount: o.items.length, total: o.total, createdAt: o.createdAt, createdById: o.createdById,
    })),
  })
}

export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { supplierId, outletIds, expectedDate, paymentTerms, notes, items } = await req.json().catch(() => ({}))
  if (!supplierId) return NextResponse.json({ error: 'supplierId is required' }, { status: 400 })
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
  }

  const parsedItems: Array<{ productId: string; purchaseUnit: string; packSize: number; quantity: number; unitPrice: number }> = []
  for (const item of items) {
    const packSize = Number(item?.packSize)
    const quantity = Number(item?.quantity)
    const unitPrice = Number(item?.unitPrice)
    if (!item?.productId || typeof item?.purchaseUnit !== 'string' || !item.purchaseUnit.trim()) {
      return NextResponse.json({ error: 'Each item needs a productId and purchaseUnit' }, { status: 400 })
    }
    if (!Number.isFinite(packSize) || packSize <= 0) {
      return NextResponse.json({ error: 'Each item needs a positive packSize' }, { status: 400 })
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: 'Each item needs a positive quantity' }, { status: 400 })
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return NextResponse.json({ error: 'Each item needs a valid unit price' }, { status: 400 })
    }
    parsedItems.push({ productId: item.productId, purchaseUnit: item.purchaseUnit.trim(), packSize, quantity, unitPrice })
  }

  try {
    const result = await createPurchaseOrder({
      supplierId, outletIds: Array.isArray(outletIds) ? outletIds : [],
      expectedDate: expectedDate ? new Date(expectedDate) : undefined,
      paymentTerms: typeof paymentTerms === 'string' ? paymentTerms.trim().slice(0, 100) || undefined : undefined,
      notes: typeof notes === 'string' ? notes.trim().slice(0, 300) || undefined : undefined,
      items: parsedItems, userId: payload.userId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Purchase order failed' }, { status: 400 })
  }
}
