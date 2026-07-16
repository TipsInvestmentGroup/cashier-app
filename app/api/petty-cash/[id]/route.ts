import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { canApprovePetty } from '@/lib/petty-access'

/** Approve or reject a petty-cash request. body: { action: 'approve' | 'reject' } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canApprovePetty(user.email))) return NextResponse.json({ error: 'Only the designated approvers can approve or reject petty cash' }, { status: 403 })

  const { id } = await params
  const { action } = await req.json().catch(() => ({}))
  if (action !== 'approve' && action !== 'reject') return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

  const existing = await prisma.pettyCash.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const status = action === 'approve' ? 'APPROVED' : 'REJECTED'
  const item = await prisma.pettyCash.update({ where: { id }, data: { status, approvedBy: user.name } })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: status, entity: 'PettyCash', entityId: id, details: `${status} by ${user.name}` },
  })

  return NextResponse.json(item)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ['ADMIN', 'ACCOUNTANT'])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  await prisma.pettyCash.delete({ where: { id } }).catch(() => null)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'PettyCash', entityId: id, details: 'Deleted petty cash request' } })
  return NextResponse.json({ ok: true })
}
