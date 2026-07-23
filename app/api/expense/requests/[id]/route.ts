import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { cancelExpenseRequest } from '@/lib/expense-requests'

const MGMT_ROLES = ['ADMIN', 'MANAGER', 'DIRECTOR', 'ACCOUNTANT']

/** GET — one expense request with items, payments, and verifications. Owner
 *  or a management role only. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const request = await prisma.expenseRequest.findUnique({
    where: { id },
    include: {
      requestType: { select: { id: true, name: true, approverRoles: true } },
      category: { select: { id: true, name: true } },
      items: true,
      paymentAllocations: { include: { expensePayment: true } },
      verifications: true,
    },
  })
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (request.requestedById !== user.userId && !MGMT_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return NextResponse.json(request)
}

/** DELETE — cancel a DRAFT/PENDING_APPROVAL request with no payments yet.
 *  Owner or ADMIN only. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.expenseRequest.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (existing.requestedById !== user.userId && user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await cancelExpenseRequest(prisma, id)
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'DELETE', entity: 'ExpenseRequest', entityId: id, details: `Cancelled expense request: ${existing.purpose}` },
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to cancel request' }, { status: 400 })
  }
}
