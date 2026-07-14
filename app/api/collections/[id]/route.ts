import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { recomputeStaffLoss } from '@/lib/staff-loss'
import { sumChannelAmounts, legacyFixedFields, syncCollectionChannels } from '@/lib/collection-channels'
import { startOfDay, endOfDay, format } from 'date-fns'

const ALLOWED = ['CASHIER', 'ADMIN', 'ACCOUNTANT']
// Roles allowed to edit/delete collections of ANY outlet; others are limited to their own.
const CROSS_OUTLET = ['ADMIN', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR']

// DayClosure types are generated on deploy; assert to avoid local type drift.
const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** True if the given outlet's day is locked. Cashiers cannot touch a closed day. */
async function isDayClosed(outletId: string, date: Date) {
  const closure = await db.dayClosure.findUnique({
    where: { outletId_date: { outletId, date: startOfDay(date) } },
    select: { id: true },
  })
  return !!closure
}

/** Update a collection and keep its auto staff-loss (voucher SL-<id>) in sync. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.dailyCollection.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  if (!CROSS_OUTLET.includes(user.role) && user.outletId && existing.outletId !== user.outletId) {
    return NextResponse.json({ error: 'You can only edit collections from your own outlet' }, { status: 403 })
  }
  if (user.role === 'CASHIER' && await isDayClosed(existing.outletId, existing.date)) {
    return NextResponse.json({ error: 'This day is closed. Ask a supervisor to reopen it before editing.' }, { status: 423 })
  }

  const body = await req.json()
  const { cash = 0, notes, outletId, date, staffName, systemSales = 0, discountReason } = body
  // channelAmounts: { CRDB: 12000, CRDB_LIPA_HAPA: 5000, ... } — any active PaymentChannel code.
  // Falls back to legacy crdb/stanbic/mpesa fields for any older caller that hasn't migrated.
  const channelAmounts: Record<string, number> = body.channelAmounts && typeof body.channelAmounts === 'object'
    ? body.channelAmounts
    : { CRDB: Number(body.crdb) || 0, STANBIC: Number(body.stanbic) || 0, MPESA: Number(body.mpesa) || 0 }
  const discount = roundMoney(Number(body.discount) || 0)
  const total = roundMoney(Number(cash) + sumChannelAmounts(channelAmounts))
  // Cashiers can never move a collection to another outlet.
  const usedOutletId = user.role === 'CASHIER' ? existing.outletId : (outletId || existing.outletId)
  const collDate = date ? new Date(date) : existing.date

  // Duplicate guard (exclude this record)
  if (staffName) {
    const dup = await prisma.dailyCollection.findFirst({
      where: {
        id: { not: id },
        outletId: usedOutletId,
        staffName,
        date: { gte: startOfDay(collDate), lte: endOfDay(collDate) },
      },
    })
    if (dup) {
      return NextResponse.json(
        { error: `Another collection for ${staffName} on ${format(collDate, 'dd MMM yyyy')} at this outlet already exists.` },
        { status: 409 }
      )
    }
  }

  const updated = await prisma.dailyCollection.update({
    where: { id },
    data: {
      cash: roundMoney(cash), ...legacyFixedFields(channelAmounts),
      total, staffName: staffName || null, systemSales: roundMoney(systemSales),
      discount, discountReason: discountReason || null,
      notes, outletId: usedOutletId, date: collDate,
    },
    include: { outlet: true },
  })
  await syncCollectionChannels(prisma, id, channelAmounts)

  // Replace cancellations for this collection if the edit form sent them.
  if (Array.isArray(body.cancellations)) {
    await prisma.cancellation.deleteMany({ where: { collectionId: id } })
    for (const cn of body.cancellations as { reason: string; productId?: string; productName: string; sellingPrice: number; quantity: number; amount: number }[]) {
      const qty = Number(cn.quantity) || 0
      const price = roundMoney(cn.sellingPrice)
      if (!cn.productName || qty <= 0) continue
      await prisma.cancellation.create({
        data: {
          collectionId: id,
          reason: cn.reason || '',
          productId: cn.productId || null,
          productName: cn.productName,
          sellingPrice: price,
          quantity: qty,
          amount: roundMoney(Number(cn.amount) || price * qty),
          outletId: usedOutletId,
          cashierId: user.userId,
          date: collDate,
        },
      })
    }
  }

  // Reconcile linked auto staff-loss — now also nets off approved cancellations.
  const shortfall = await recomputeStaffLoss(prisma, id)
  const staffLoss = staffName && shortfall > 0 ? { amount: shortfall, staffName } : null

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'DailyCollection', entityId: id, details: `Total ${total}, staffLoss ${shortfall > 0 ? shortfall : 0}` },
  })

  return NextResponse.json({ ...updated, staffLoss })
}

/** Delete a collection and its auto staff-loss. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.dailyCollection.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  if (!CROSS_OUTLET.includes(user.role) && user.outletId && existing.outletId !== user.outletId) {
    return NextResponse.json({ error: 'You can only delete collections from your own outlet' }, { status: 403 })
  }
  if (user.role === 'CASHIER' && await isDayClosed(existing.outletId, existing.date)) {
    return NextResponse.json({ error: 'This day is closed. Ask a supervisor to reopen it before deleting.' }, { status: 423 })
  }

  // Remove linked auto staff-loss (and its payments) first
  const sl = await prisma.signedBill.findUnique({ where: { voucherNumber: `SL-${id}` } })
  if (sl) {
    await prisma.paidBill.deleteMany({ where: { signedBillId: sl.id } })
    await prisma.signedBill.delete({ where: { id: sl.id } })
  }
  // Remove linked cancellations (FK) before deleting the collection
  await prisma.cancellation.deleteMany({ where: { collectionId: id } })
  await prisma.dailyCollection.delete({ where: { id } })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'DailyCollection', entityId: id, details: `Deleted collection${sl ? ' + linked staff loss' : ''}` },
  })

  return NextResponse.json({ ok: true, removedStaffLoss: !!sl })
}
