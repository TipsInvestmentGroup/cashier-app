import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { recomputeStaffLoss } from '@/lib/staff-loss'
import { sumChannelAmounts, legacyFixedFields, syncCollectionChannels } from '@/lib/collection-channels'
import { isValidExcessReasonCode, excessReasonCategoryDb } from '@/lib/excess-reasons-db'
import { primaryChannelFromAmounts } from '@/lib/collection-channels'
import { generateBillReference } from '@/lib/bill-reference'
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

  // Sync submitted excess line items (upsert-by-id, preserving paidAmount and
  // blocking removal of settled rows — same rule as Cash Recon's excessItems).
  if (Array.isArray(body.excessItems)) {
    const rawItems: { id?: string; amount: number; reason: string; staffId?: string; personId?: string; notes?: string }[] = body.excessItems
    const items = rawItems
      .map((it) => ({ id: it.id || null, amount: roundMoney(it.amount), reason: it.reason, staffId: it.staffId || null, personId: it.personId || null, notes: it.notes?.trim() || null }))
      .filter((it) => it.amount > 0)
    const categories = new Map<string, string>()
    for (const it of items) {
      if (!(await isValidExcessReasonCode(it.reason))) {
        return NextResponse.json({ error: 'Select a reason for each excess amount collected' }, { status: 400 })
      }
      const category = await excessReasonCategoryDb(it.reason)
      if (!category) return NextResponse.json({ error: 'Select a valid reason for each excess amount collected' }, { status: 400 })
      categories.set(it.reason, category)
      if (it.reason === 'STAFF_TIP' && !it.staffId) return NextResponse.json({ error: 'Select the staff name for the excess amount collected' }, { status: 400 })
      if (it.reason === 'CUSTOMER_EXCESS' && !it.personId) return NextResponse.json({ error: 'Select the customer name for the excess amount collected' }, { status: 400 })
    }
    const primaryChannelCode = primaryChannelFromAmounts(Number(cash) || 0, channelAmounts)
    const [staffRows, personRows] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: items.filter((i) => i.staffId).map((i) => i.staffId as string) } }, select: { id: true, name: true } }),
      prisma.person.findMany({ where: { id: { in: items.filter((i) => i.personId).map((i) => i.personId as string) } }, select: { id: true, name: true } }),
    ])
    const priorItems = await db.collectionExcess.findMany({ where: { collectionId: id } })
    const incomingIds = new Set(items.filter((it) => it.id).map((it) => it.id as string))
    const toRemove = priorItems.filter((p: { id: string; paidAmount: number }) => !incomingIds.has(p.id))
    const blockedRemoval = toRemove.find((p: { paidAmount: number }) => p.paidAmount > 0)
    if (blockedRemoval) {
      return NextResponse.json({ error: `Cannot remove an excess item that already has ${blockedRemoval.paidAmount} settled — clear its payments in Excess Recon first` }, { status: 409 })
    }
    if (toRemove.length > 0) {
      await db.collectionExcess.deleteMany({ where: { id: { in: toRemove.map((p: { id: string }) => p.id) } } })
    }
    for (const it of items) {
      const fields = {
        amount: it.amount, reason: it.reason, category: categories.get(it.reason)!, notes: it.notes, channelCode: primaryChannelCode,
        staffId: it.staffId, staffName: it.staffId ? staffRows.find((s) => s.id === it.staffId)?.name || null : null,
        personId: it.personId, personName: it.personId ? personRows.find((p) => p.id === it.personId)?.name || null : null,
      }
      if (it.id && priorItems.some((p: { id: string }) => p.id === it.id)) {
        await db.collectionExcess.update({ where: { id: it.id }, data: fields })
      } else {
        // Small dedicated transaction — the bill-reference generation must be
        // atomic with this row's creation (see lib/bill-reference.ts).
        await prisma.$transaction(async (tx) => {
          const recordId = crypto.randomUUID()
          const ref = await generateBillReference(tx, {
            recordId, sourceModel: 'CollectionExcess', billTypeCode: 'EXS', date: collDate, personId: it.personId, outletId: usedOutletId,
          })
          await tx.collectionExcess.create({
            data: {
              id: recordId, collectionId: id, ...fields,
              internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
            },
          })
        })
      }
    }
  }

  // Reconcile linked auto staff-loss — now also nets off approved cancellations,
  // and true up excess line items to the recomputed total (see lib/collection-excess.ts).
  // Wrapped in a transaction so the bill-reference generation inside
  // recomputeStaffLoss stays atomic with the SignedBill it creates.
  const shortfall = await prisma.$transaction((tx) => recomputeStaffLoss(tx, id))
  const staffLoss = staffName && shortfall > 0 ? { amount: shortfall, staffName } : null

  // Before/after snapshot of the fields that actually changed, plus the
  // caller's stated reason (if any) — so an admin tracing a discrepancy back
  // through /audit sees exactly what changed and why, not just the new total.
  const CHANGED_FIELDS = ['cash', 'crdb', 'stanbic', 'mpesa', 'total', 'staffName', 'systemSales', 'discount', 'notes', 'outletId', 'date'] as const
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  for (const field of CHANGED_FIELDS) {
    const before = existing[field] instanceof Date ? existing[field].toISOString() : existing[field]
    const after = updated[field] instanceof Date ? updated[field].toISOString() : updated[field]
    if (before !== after) changes[field] = { from: before, to: after }
  }

  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'UPDATE', entity: 'DailyCollection', entityId: id,
      details: JSON.stringify({ changes, staffLoss: shortfall > 0 ? shortfall : 0, reason: body.reason || null }),
    },
  })

  return NextResponse.json({ ...updated, staffLoss })
}

/** Delete a collection and its auto staff-loss. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const existing = await prisma.dailyCollection.findUnique({ where: { id }, include: { outlet: { select: { name: true } } } })
  if (!existing) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })
  if (!CROSS_OUTLET.includes(user.role) && user.outletId && existing.outletId !== user.outletId) {
    return NextResponse.json({ error: 'You can only delete collections from your own outlet' }, { status: 403 })
  }
  if (user.role === 'CASHIER' && await isDayClosed(existing.outletId, existing.date)) {
    return NextResponse.json({ error: 'This day is closed. Ask a supervisor to reopen it before deleting.' }, { status: 423 })
  }
  const excessItems = await db.collectionExcess.findMany({ where: { collectionId: id } })
  if (excessItems.some((it: { paidAmount: number }) => it.paidAmount > 0)) {
    return NextResponse.json({ error: 'This collection has a settled excess amount in Excess Recon — it cannot be deleted.' }, { status: 409 })
  }

  // Remove linked auto staff-loss (and its payments) first
  const sl = await prisma.signedBill.findUnique({ where: { autoKey: `SL-${id}` } })
  if (sl) {
    await prisma.paidBill.deleteMany({ where: { signedBillId: sl.id } })
    await prisma.signedBill.delete({ where: { id: sl.id } })
  }
  // Remove linked cancellations (FK) before deleting the collection
  await prisma.cancellation.deleteMany({ where: { collectionId: id } })
  await prisma.dailyCollection.delete({ where: { id } })

  // Full snapshot of the deleted record (not just its id) — once deleted,
  // dailyCollection.findUnique(entityId) returns nothing, so this audit row
  // is the ONLY place an admin can later see what the record actually
  // contained (staff, amounts, outlet, date) alongside who deleted it, when,
  // and why.
  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'DELETE', entity: 'DailyCollection', entityId: id,
      details: JSON.stringify({
        reason: body.reason || null,
        removedStaffLoss: !!sl,
        snapshot: {
          date: existing.date.toISOString(), outletName: existing.outlet.name, staffName: existing.staffName,
          total: existing.total, cash: existing.cash, crdb: existing.crdb, stanbic: existing.stanbic, mpesa: existing.mpesa,
          systemSales: existing.systemSales, creditSales: existing.creditSales, paymentsReceived: existing.paymentsReceived,
          discount: existing.discount, notes: existing.notes, createdAt: existing.createdAt.toISOString(),
        },
      }),
    },
  })

  return NextResponse.json({ ok: true, removedStaffLoss: !!sl })
}
