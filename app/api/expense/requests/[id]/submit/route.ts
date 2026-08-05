import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { submitExpenseRequest } from '@/lib/expense-requests'

/** POST — submit a DRAFT request (→ PENDING_APPROVAL or straight to APPROVED
 *  when the request type has no approver roles configured). Owner or ADMIN. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.expenseRequest.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (existing.requestedById !== user.userId && user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    // Wrapped so a below-threshold top-up's credit + status change are atomic
    // (submitExpenseRequest may execute the allocation for an IN request that
    // skips approval).
    const result = await prisma.$transaction((tx) => submitExpenseRequest(tx, id))
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseRequest', entityId: id, details: `Submitted expense request → ${result.status}` },
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to submit request' }, { status: 400 })
  }
}
