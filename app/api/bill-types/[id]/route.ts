import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'

const CAN_MANAGE = ['ADMIN', 'DIRECTOR']

/** Edit a bill type — name/prefix/isActive/sortOrder only. `code` and
 *  `category` are the stable identity once created (billTypeConfigId on
 *  already-issued bills links against them) and are never accepted here even
 *  if present in the body. ADMIN/DIRECTOR only. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_MANAGE)) return NextResponse.json({ error: 'You are not authorized to edit bill types' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const existing = await prisma.billTypeConfig.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Bill type not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body.prefix !== undefined) {
    const prefix = String(body.prefix).trim()
    if (!prefix) return NextResponse.json({ error: 'Prefix cannot be empty' }, { status: 400 })
    data.prefix = prefix
  }
  if (body.isActive !== undefined) data.isActive = !!body.isActive
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0

  try {
    const item = await prisma.billTypeConfig.update({ where: { id }, data })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'BillTypeConfig', entityId: id, details: `Edited bill type ${item.name} (${item.code})` },
    })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Could not update bill type' }, { status: 400 })
  }
}

/** Delete a bill type — only allowed when truly unused (no sequence counter,
 *  no bill of any of the 6 source models references it). Once a type has
 *  been used, deactivation (PUT isActive:false) is the only supported
 *  "removal" path. ADMIN/DIRECTOR only. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_MANAGE)) return NextResponse.json({ error: 'You are not authorized to delete bill types' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.billTypeConfig.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Bill type not found' }, { status: 404 })

  const [
    counterCount,
    signedBillCount,
    paidBillCount,
    cashReconExcessCount,
    collectionExcessCount,
    breakageCount,
    excessRefundCount,
  ] = await Promise.all([
    prisma.billSequenceCounter.count({ where: { scopeKey: { contains: `BT:${id}` } } }),
    prisma.signedBill.count({ where: { billTypeConfigId: id } }),
    prisma.paidBill.count({ where: { billTypeConfigId: id } }),
    prisma.cashReconExcess.count({ where: { billTypeConfigId: id } }),
    prisma.collectionExcess.count({ where: { billTypeConfigId: id } }),
    prisma.breakage.count({ where: { billTypeConfigId: id } }),
    prisma.excessRefund.count({ where: { billTypeConfigId: id } }),
  ])

  const inUse: string[] = []
  if (counterCount > 0) inUse.push(`${counterCount} sequence counter(s)`)
  if (signedBillCount > 0) inUse.push(`${signedBillCount} Signed Bill(s)`)
  if (paidBillCount > 0) inUse.push(`${paidBillCount} Paid Bill(s)`)
  if (cashReconExcessCount > 0) inUse.push(`${cashReconExcessCount} Cash Recon Excess(es)`)
  if (collectionExcessCount > 0) inUse.push(`${collectionExcessCount} Collection Excess(es)`)
  if (breakageCount > 0) inUse.push(`${breakageCount} Breakage(s)`)
  if (excessRefundCount > 0) inUse.push(`${excessRefundCount} Excess Refund(s)`)

  if (inUse.length > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete "${existing.name}" — it is already in use by ${inUse.join(', ')}. ` +
          `Deactivate it instead (Active toggle) once a bill type has been used; deleting is only possible for a truly-unused custom type.`,
      },
      { status: 409 }
    )
  }

  await prisma.billTypeConfig.delete({ where: { id } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'BillTypeConfig', entityId: id, details: `Deleted bill type ${existing.name} (${existing.code})` },
  })
  return NextResponse.json({ ok: true })
}
