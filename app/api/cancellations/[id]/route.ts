import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { recomputeStaffLoss } from '@/lib/staff-loss'
import { getCancellationApprovers } from '@/lib/approvals'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

async function canApproveCancellations(email?: string): Promise<boolean> {
  const e = (email || '').toLowerCase()
  if (!!OWNER_EMAIL && e === OWNER_EMAIL) return true
  return (await getCancellationApprovers()).includes(e)
}

/** Approve or reject a cancellation. body: { action: 'approve' | 'reject' } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canApproveCancellations(user.email))) return NextResponse.json({ error: 'You are not authorised to approve or reject cancellations' }, { status: 403 })

  const { id } = await params
  const { action } = await req.json().catch(() => ({}))
  if (action !== 'approve' && action !== 'reject') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const existing = await prisma.cancellation.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Cancellation not found' }, { status: 404 })

  const status = action === 'approve' ? 'APPROVED' : 'REJECTED'
  const item = await prisma.cancellation.update({ where: { id }, data: { status, approvedBy: user.name } })

  // Approving/rejecting a cancellation linked to a collection changes the
  // staff-loss formula (approved cancellations reduce the loss) — recompute it.
  // Wrapped in a transaction so bill-reference generation inside
  // recomputeStaffLoss stays atomic with the SignedBill it creates.
  if (existing.collectionId) await prisma.$transaction((tx) => recomputeStaffLoss(tx, existing.collectionId!))

  await prisma.auditLog.create({
    data: { userId: user.userId, action: status, entity: 'Cancellation', entityId: id, details: `${status} cancellation of ${existing.productName} by ${user.name}` },
  })
  return NextResponse.json(item)
}
