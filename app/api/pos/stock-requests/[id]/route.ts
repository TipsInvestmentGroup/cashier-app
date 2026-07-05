import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SUPPLIER_POSITION, MANAGEMENT_ROLES } from '@/lib/shared-constants'

/**
 * PATCH /api/pos/stock-requests/[id] — the supplying counter's staffer marks
 * a stock request as fulfilled (physically handed over the product).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { id } = await params
  const request = await prisma.posStockRequest.findUnique({ where: { id } })
  if (!request) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (request.outletId !== payload.outletId && !MANAGEMENT_ROLES.includes(payload.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const canFulfil = MANAGEMENT_ROLES.includes(payload.role) || SUPPLIER_POSITION[request.toCounter] === payload.position
  if (!canFulfil) return NextResponse.json({ error: 'Only the supplying counter can fulfil this request' }, { status: 403 })
  if (request.status !== 'PENDING') return NextResponse.json(request)

  const updated = await prisma.posStockRequest.update({
    where: { id },
    data: { status: 'FULFILLED', fulfilledById: payload.userId, fulfilledAt: new Date() },
  })

  return NextResponse.json(updated)
}
