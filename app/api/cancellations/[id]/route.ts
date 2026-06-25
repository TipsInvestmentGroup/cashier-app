import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { recomputeStaffLoss } from '@/lib/staff-loss'
import { PETTY_APPROVERS } from '@/lib/petty-access'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

function canApproveCancellations(email?: string): boolean {
  const e = (email || '').toLowerCase()
  return PETTY_APPROVERS.includes(e) || (!!OWNER_EMAIL && e === OWNER_EMAIL)
}

/** Approve or reject a cancellation. body: { action: 'approve' | 'reject' } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canApproveCancellations(user.email)) return NextResponse.json({ error: 'You are not authorised to approve or reject cancellations' }, { status: 403 })

  const { id } = await params
  const { action } = await req.json().catch(() => ({}))
  if (action !== 'approve' && action !== 'reject') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const existing = await prisma.cancellation.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Cancellation not found' }, { status: 404 })

  const status = action === 'approve' ? 'APPROVED' : 'REJECTED'
  const item = await prisma.cancellation.update({ where: { id }, data: { status, approvedBy: user.name } })

  // Approving/rejecting a cancellation linked to a collection changes the
  // staff-loss formula (approved cancellations reduce the loss) — recompute it.
  if (existing.collectionId) await recomputeStaffLoss(prisma, existing.collectionId)

  await prisma.auditLog.create({
    data: { userId: user.userId, action: status, entity: 'Cancellation', entityId: id, details: `${status} cancellation of ${existing.productName} by ${user.name}` },
  })
  return NextResponse.json(item)
}
