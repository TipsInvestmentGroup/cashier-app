import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { receiveGrn } from '@/lib/stock'

/**
 * POST /api/inventory/grn
 * body: { warehouseId, supplierName, invoiceRef?, note?, items: [{ productId, purchaseUnit, packSize, quantityOrdered, unitCost? }] }
 * No-PO free-form goods-received note — records physical receipt of stock
 * into a Warehouse (see lib/stock.ts's receiveGrn).
 */
export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { warehouseId, supplierName, invoiceRef, note, items } = await req.json().catch(() => ({}))
  if (!warehouseId || !supplierName) {
    return NextResponse.json({ error: 'warehouseId and supplierName are required' }, { status: 400 })
  }
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
  }

  const parsedItems: Array<{ productId: string; purchaseUnit: string; packSize: number; quantityOrdered: number; unitCost?: number }> = []
  for (const item of items) {
    const packSize = Number(item?.packSize)
    const quantityOrdered = Number(item?.quantityOrdered)
    if (!item?.productId || typeof item?.purchaseUnit !== 'string' || !item.purchaseUnit.trim()) {
      return NextResponse.json({ error: 'Each item needs a productId and purchaseUnit' }, { status: 400 })
    }
    if (!Number.isFinite(packSize) || packSize <= 0) {
      return NextResponse.json({ error: 'Each item needs a positive packSize' }, { status: 400 })
    }
    if (!Number.isFinite(quantityOrdered) || quantityOrdered <= 0) {
      return NextResponse.json({ error: 'Each item needs a positive quantityOrdered' }, { status: 400 })
    }
    const unitCost = item.unitCost === undefined || item.unitCost === null || item.unitCost === '' ? undefined : Number(item.unitCost)
    parsedItems.push({
      productId: item.productId, purchaseUnit: item.purchaseUnit.trim(), packSize, quantityOrdered,
      unitCost: unitCost !== undefined && Number.isFinite(unitCost) ? unitCost : undefined,
    })
  }

  try {
    const result = await receiveGrn({
      warehouseId, supplierName: String(supplierName).trim().slice(0, 200),
      invoiceRef: typeof invoiceRef === 'string' ? invoiceRef.trim().slice(0, 100) || undefined : undefined,
      note: typeof note === 'string' ? note.trim().slice(0, 300) || undefined : undefined,
      items: parsedItems, userId: payload.userId,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'GRN failed' }, { status: 400 })
  }
}

/**
 * GET /api/inventory/grn?warehouseId=
 * Recent GRNs for the history view, most recent first.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const warehouseId = req.nextUrl.searchParams.get('warehouseId')
  if (!warehouseId) return NextResponse.json({ error: 'warehouseId required' }, { status: 400 })

  const grns = await prisma.grn.findMany({
    where: { warehouseId },
    include: { items: { select: { piecesReceived: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return NextResponse.json({
    rows: grns.map((g) => ({
      id: g.id, grnNumber: g.grnNumber, supplierName: g.supplierName, invoiceRef: g.invoiceRef,
      receivedDate: g.receivedDate, note: g.note, itemCount: g.items.length,
      totalPieces: g.items.reduce((sum, i) => sum + i.piecesReceived, 0), createdAt: g.createdAt,
    })),
  })
}
