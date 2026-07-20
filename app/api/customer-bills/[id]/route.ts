import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { postCreditSale } from '@/lib/finance-ar'

const APPROVERS = ['ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** Approve or reject a Customer bill request. body: { action: 'approve' | 'reject' } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, APPROVERS)) return NextResponse.json({ error: 'Only managers/accountants can approve or reject' }, { status: 403 })

  const { id } = await params
  const { action } = await req.json().catch(() => ({}))
  if (action !== 'approve' && action !== 'reject') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const existing = await prisma.signedBill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  if (existing.billType !== 'CUSTOMER') return NextResponse.json({ error: 'Not a Customer bill' }, { status: 400 })

  const approvalStatus = action === 'approve' ? 'APPROVED' : 'REJECTED'
  const item = await prisma.signedBill.update({ where: { id }, data: { approvalStatus, approvedBy: user.name } })
  if (approvalStatus === 'APPROVED') await postCreditSale(prisma, item, user.userId)

  await prisma.auditLog.create({
    data: { userId: user.userId, action: approvalStatus, entity: 'SignedBill', entityId: id, details: `${approvalStatus} customer bill for ${existing.personName} by ${user.name}` },
  })
  return NextResponse.json(item)
}
