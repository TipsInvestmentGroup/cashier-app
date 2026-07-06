import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'
import { submitForApproval, decidePurchaseOrder, cancelPurchaseOrder } from '@/lib/stock'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/inventory/purchase-orders/[id]
 * Full detail with items + linked GRNs.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { supplier: true, items: true, grns: { select: { id: true, grnNumber: true, receivedDate: true } } },
  })
  if (!po) return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })

  return NextResponse.json({ purchaseOrder: po })
}

/**
 * PATCH /api/inventory/purchase-orders/[id]
 * body: { action: 'submit' | 'approve' | 'reject' | 'cancel', reason? }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { action, reason } = await req.json().catch(() => ({}))
  if (!['submit', 'approve', 'reject', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    let result: { status: string }
    if (action === 'submit') {
      result = await submitForApproval(id)
    } else if (action === 'cancel') {
      result = await cancelPurchaseOrder({ purchaseOrderId: id, reason: typeof reason === 'string' ? reason : undefined })
    } else {
      result = await decidePurchaseOrder({
        purchaseOrderId: id, userId: payload.userId, action,
        reason: typeof reason === 'string' ? reason : undefined,
      })
    }
    await prisma.auditLog.create({
      data: { userId: payload.userId, action: action.toUpperCase(), entity: 'PurchaseOrder', entityId: id, details: `${action} -> ${result.status}` },
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Action failed' }, { status: 400 })
  }
}
