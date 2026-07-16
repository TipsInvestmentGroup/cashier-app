import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'
import { invalidateExcessReasonCache } from '@/lib/excess-reasons-db'

// STAFF_TIP/CUSTOMER_EXCESS are wired into fixed picker behavior (staff/customer
// selection) in AddExcessModal.tsx and CashReconForm.tsx by this exact code —
// deleting the row (not just disabling it) would silently break that UI logic
// for good, so it's blocked entirely. Renaming the label or disabling is fine.
const PROTECTED_CODES = ['STAFF_TIP', 'CUSTOMER_EXCESS']

/** Edit a reason (rename / activate) — authorized managers only. Code is immutable. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.label !== undefined) data.label = String(body.label).trim()
  if (body.isActive !== undefined) data.isActive = !!body.isActive

  try {
    const item = await prisma.excessReason.update({ where: { id }, data })
    invalidateExcessReasonCache()
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'ExcessReason', entityId: id, details: `Edited ${item.label}` } })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Could not update reason' }, { status: 400 })
  }
}

/** Delete a reason — authorized managers only. Blocks if protected or in use. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const { id } = await params
  const reason = await prisma.excessReason.findUnique({ where: { id } })
  if (!reason) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (PROTECTED_CODES.includes(reason.code)) {
    return NextResponse.json({ error: 'This reason is wired into the excess picker UI — disable it instead of deleting.' }, { status: 409 })
  }
  const [inUseRecon, inUseCollection] = await Promise.all([
    prisma.cashReconExcess.count({ where: { reason: reason.code } }),
    prisma.collectionExcess.count({ where: { reason: reason.code } }),
  ])
  if (inUseRecon + inUseCollection > 0) {
    return NextResponse.json({ error: 'This reason is in use by recorded excess amounts — disable it instead of deleting.' }, { status: 409 })
  }
  await prisma.excessReason.delete({ where: { id } }).catch(() => null)
  invalidateExcessReasonCache()
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'ExcessReason', entityId: id, details: `Deleted ${reason.label}` } })
  return NextResponse.json({ ok: true })
}
