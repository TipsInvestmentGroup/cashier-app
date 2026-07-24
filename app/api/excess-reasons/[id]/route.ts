import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'
import { invalidateExcessReasonCache } from '@/lib/excess-reasons-db'
import { RESERVED_REASON_CODES } from '@/lib/excess-reasons'
import { classForReason } from '@/lib/reconciliation-classification'

// STAFF_TIP/CUSTOMER_EXCESS/STAFF_LOSS are wired into fixed engine behavior
// (staff/customer picker unlock, auto-SignedBill debt path) by this exact
// code — deleting the row (or changing its category) would silently break
// that logic for good, so both are blocked entirely. Renaming the label or
// disabling is fine.
const PROTECTED_CODES = RESERVED_REASON_CODES

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
  if (body.allocationStrategy !== undefined) {
    if (!['FIFO', 'LIFO'].includes(body.allocationStrategy)) {
      return NextResponse.json({ error: 'allocationStrategy must be FIFO or LIFO' }, { status: 400 })
    }
    data.allocationStrategy = body.allocationStrategy
  }
  if (body.category !== undefined && ['PAYABLE_EXCESS', 'NON_PAYABLE', 'STAFF_LOSS'].includes(body.category)) {
    const existing = await prisma.excessReason.findUnique({ where: { id } })
    if (existing && RESERVED_REASON_CODES.includes(existing.code)) {
      return NextResponse.json({ error: 'This reason\'s category is wired into fixed engine behavior and cannot be changed.' }, { status: 409 })
    }
    // STAFF_LOSS (the receivable auto-debt category) is reserved — a custom
    // reason can only be PAYABLE_EXCESS or NON_PAYABLE.
    if (body.category === 'STAFF_LOSS') {
      return NextResponse.json({ error: 'The Staff Loss category is reserved and cannot be assigned to a custom reason.' }, { status: 400 })
    }
    data.category = body.category
    data.accountingClass = classForReason(existing?.code, body.category)
  }

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
