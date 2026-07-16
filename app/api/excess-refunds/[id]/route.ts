import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'

const CAN_WRITE = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** Approve or reject an Excess Refund. body: { action: 'approve' | 'reject' } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_WRITE)) return NextResponse.json({ error: 'You are not authorized to approve or reject excess refunds' }, { status: 403 })

  const { id } = await params
  const { action } = await req.json().catch(() => ({}))
  if (action !== 'approve' && action !== 'reject') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const existing = await prisma.excessRefund.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Excess refund not found' }, { status: 404 })

  const approvalStatus = action === 'approve' ? 'APPROVED' : 'REJECTED'
  const item = await prisma.excessRefund.update({ where: { id }, data: { approvalStatus, approvedBy: user.name } })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: approvalStatus, entity: 'ExcessRefund', entityId: id, details: `${approvalStatus} excess refund for ${existing.personName} by ${user.name}` },
  })
  return NextResponse.json(item)
}
