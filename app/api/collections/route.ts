import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, NO_OUTLET, writeOutletId } from '@/lib/auth'
import { allocatePayment } from '@/lib/payment-alloc'
import { roundMoney } from '@/lib/utils'
import { isValidExcessReasonCode } from '@/lib/excess-reasons-db'
import { sumChannelAmounts, legacyFixedFields, syncCollectionChannels } from '@/lib/collection-channels'
import { findBestPersonMatch } from '@/lib/nameMatch'
import { generateBillReference, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'
import { resolveBusinessDate } from '@/lib/business-date'
import { getCompanyConfig } from '@/lib/company-config'
import { startOfDay, endOfDay, format } from 'date-fns'

// Resolve a free-text signed-bill name to a Person: use an explicit personId from
// the client when given (the cashier already confirmed it in the UI), otherwise
// fuzzy-match against existing persons of the same type, and auto-create a new
// Person when nothing matches so the entry is never missing from Accounts Receivable.
async function resolvePerson(
  tx: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  name: string, type: string, personId?: string | null, confirmedNew?: boolean
) {
  if (personId) {
    const existing = await tx.person.findUnique({ where: { id: personId } })
    if (existing) return existing
  }
  if (!confirmedNew) {
    const candidates = await tx.person.findMany({ where: { type }, select: { id: true, name: true } })
    const result = findBestPersonMatch(name, candidates)
    if (result.kind === 'exact' || result.kind === 'similar') {
      return tx.person.findUnique({ where: { id: result.match.id } })
    }
  }
  return tx.person.create({ data: { name, type, isActive: true } })
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  // Cashiers are strictly locked to their own outlet (no outlet = see nothing).
  const outletId = user.role === 'CASHIER'
    ? (user.outletId || NO_OUTLET)
    : (searchParams.get('outletId') || user.outletId)
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId
  if (startDate && endDate) {
    where.date = { gte: new Date(startDate), lte: new Date(endDate) }
  }

  const collections = await prisma.dailyCollection.findMany({
    where,
    include: { outlet: true, cashier: { select: { name: true } }, cancellations: true, channels: true, excessItems: true },
    orderBy: { date: 'desc' },
    take: 100,
  })

  return NextResponse.json(collections)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['CASHIER', 'ADMIN', 'ACCOUNTANT'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { cash = 0, notes, outletId, date, staffName, systemSales = 0, discountReason } = body
  // channelAmounts: { CRDB: 12000, CRDB_LIPA_HAPA: 5000, ... } — any active PaymentChannel code.
  // Falls back to legacy crdb/stanbic/mpesa fields for any older caller that hasn't migrated.
  const channelAmounts: Record<string, number> = body.channelAmounts && typeof body.channelAmounts === 'object'
    ? body.channelAmounts
    : { CRDB: Number(body.crdb) || 0, STANBIC: Number(body.stanbic) || 0, MPESA: Number(body.mpesa) || 0 }
  const discount = roundMoney(Number(body.discount) || 0)
  // Reconciliation inputs entered during the collection flow
  const signedInput: { billType: string; name: string; amount: number; personId?: string; confirmedNew?: boolean }[] = Array.isArray(body.signedBills) ? body.signedBills : []
  const paidInput: { payerName: string; amount: number; paymentMethod: string; category?: string; categoryBillType?: string; signedBillId?: string; selectedBillIds?: string[] }[] = Array.isArray(body.paidBills) ? body.paidBills : []
  const cancelInput: { reason: string; productId?: string; productName: string; sellingPrice: number; quantity: number; amount: number }[] = Array.isArray(body.cancellations) ? body.cancellations : []
  const excessItemsInput: { amount: number; reason: string; staffId?: string; personId?: string }[] = Array.isArray(body.excessItems) ? body.excessItems : []

  const total = roundMoney(Number(cash) + sumChannelAmounts(channelAmounts))
  const usedOutletId = writeOutletId(user, outletId)
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })

  // Prevent duplicates: one collection per staff, per outlet, per day.
  const { businessDayCutoverHour } = await getCompanyConfig()
  const collDate = date ? new Date(date) : resolveBusinessDate(new Date(), businessDayCutoverHour)

  // A closed day is locked for cashiers — no new collections.
  if (user.role === 'CASHIER') {
    const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any
    const closed = await db.dayClosure.findUnique({ where: { outletId_date: { outletId: usedOutletId, date: startOfDay(collDate) } }, select: { id: true } })
    if (closed) return NextResponse.json({ error: 'This day is closed. Ask a supervisor to reopen it before adding collections.' }, { status: 423 })
  }
  if (staffName) {
    const dup = await prisma.dailyCollection.findFirst({
      where: {
        outletId: usedOutletId,
        staffName,
        date: { gte: startOfDay(collDate), lte: endOfDay(collDate) },
      },
    })
    if (dup) {
      return NextResponse.json(
        { error: `A collection for ${staffName} on ${format(collDate, 'dd MMM yyyy')} at this outlet already exists. Edit or delete it instead of re-entering.` },
        { status: 409 }
      )
    }
  }

  // All writes for one collection run atomically — a mid-way failure rolls back
  // the whole thing (no half-saved collections/bills/allocations).
  let out
  try {
  out = await prisma.$transaction(async (tx) => {
    const collection = await tx.dailyCollection.create({
      data: {
        cash: roundMoney(cash), ...legacyFixedFields(channelAmounts),
        total, staffName: staffName || null, systemSales: roundMoney(systemSales),
        discount, discountReason: discountReason || null,
        notes, outletId: usedOutletId, cashierId: user.userId, date: collDate,
      },
      include: { outlet: true },
    })
    await syncCollectionChannels(tx, collection.id, channelAmounts)

    await tx.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'DailyCollection', entityId: collection.id, details: `Total: ${total}` },
    })

    // 1) Signed bills (credit sales) recorded by this staff
    let signedTotal = 0
    let signedCreated = 0
    for (let i = 0; i < signedInput.length; i++) {
      const sb = signedInput[i]
      const amt = roundMoney(sb.amount)
      const type = String(sb.billType || '').toUpperCase()
      if (amt <= 0 || !type || !sb.name) continue
      const person = await resolvePerson(tx, sb.name, type, sb.personId, sb.confirmedNew)
      const recordId = crypto.randomUUID()
      const billTypeCode = await resolveBillTypeCodeFromLegacy(tx, 'SIGNED_BILL', type)
      const ref = await generateBillReference(tx, {
        recordId, sourceModel: 'SignedBill', billTypeCode, date: collDate, personId: person?.id ?? null, outletId: usedOutletId,
      })
      await tx.signedBill.create({
        data: {
          id: recordId,
          autoKey: `VCH-${collection.id}-${i}`, voucherNumber: ref.displayReference, billType: type, personId: person?.id ?? null, personName: sb.name,
          amount: amt, serviceStaff: staffName || null, description: `Recorded during daily collection ${collection.id}`,
          status: 'UNPAID', date: collDate, outletId: usedOutletId, cashierId: user.userId,
          internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
        },
      })
      signedTotal += amt
      signedCreated++
    }

    // 2) Paid bills (debt recoveries). Only the "Staff Loss" category offsets the loss.
    let paidTotal = 0
    let paidStaffLoss = 0
    let paidCreated = 0
    for (const pb of paidInput) {
      const amt = roundMoney(pb.amount)
      const method = String(pb.paymentMethod || 'CASH').toUpperCase()
      if (amt <= 0 || !method || !pb.payerName) continue
      const selectedBillIds = Array.isArray(pb.selectedBillIds) ? pb.selectedBillIds : (pb.signedBillId ? [pb.signedBillId] : [])
      await allocatePayment(tx, {
        payerName: pb.payerName, category: pb.category || null, categoryBillType: pb.categoryBillType || null, totalAmount: amt,
        selectedBillIds, paymentMethod: method, outletId: usedOutletId, cashierId: user.userId,
        date: collDate, billRef: `COL-${collection.id}`, notes: `Recovery recorded during daily collection ${collection.id}`,
      })
      paidTotal += amt
      if ((pb.category || '') === 'Staff Loss') paidStaffLoss += amt
      paidCreated++
    }

    // 2b) Cancellations linked to this collection
    for (const cn of cancelInput) {
      const qty = Number(cn.quantity) || 0
      const price = roundMoney(cn.sellingPrice)
      const reason = cn.reason || ''
      if (!cn.productName || qty <= 0) continue
      await tx.cancellation.create({
        data: {
          collectionId: collection.id, reason, productId: cn.productId || null, productName: cn.productName,
          sellingPrice: price, quantity: qty, amount: roundMoney(Number(cn.amount) || price * qty),
          outletId: usedOutletId, cashierId: user.userId, date: collDate,
        },
      })
    }

    await tx.dailyCollection.update({
      where: { id: collection.id },
      data: { creditSales: roundMoney(signedTotal), paymentsReceived: roundMoney(paidStaffLoss) },
    })

    // 3) Staff Loss = System − Collection − SignedBills − PaidBills (Staff Loss only) − Discount
    const lossAmount = roundMoney((Number(systemSales) || 0) - total - signedTotal - paidStaffLoss - discount)
    let staffLoss: { amount: number; voucher: string; staffName: string } | null = null
    if (staffName && lossAmount > 0) {
      const person = await tx.person.findFirst({ where: { name: staffName, type: 'STAFF_LOSS' } })
      const autoKey = `SL-${collection.id}`
      const recordId = crypto.randomUUID()
      const billTypeCode = await resolveBillTypeCodeFromLegacy(tx, 'SIGNED_BILL', 'STAFF_LOSS')
      const ref = await generateBillReference(tx, {
        recordId, sourceModel: 'SignedBill', billTypeCode, date: collDate, personId: person?.id ?? null, outletId: usedOutletId,
      })
      const bill = await tx.signedBill.create({
        data: {
          id: recordId,
          autoKey, voucherNumber: ref.displayReference, billType: 'STAFF_LOSS', personId: person?.id ?? null, personName: staffName,
          amount: lossAmount, serviceStaff: staffName,
          description: `Auto staff loss: System ${Number(systemSales)} − collected ${total} − signed ${signedTotal} − paid·staffloss ${paidStaffLoss} − discount ${discount} (collection ${collection.id})`,
          status: 'UNPAID', date: collDate, outletId: usedOutletId, cashierId: user.userId,
          internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
          autoSourceCollectionId: collection.id,
        },
      })
      await tx.auditLog.create({
        data: { userId: user.userId, action: 'CREATE', entity: 'SignedBill', entityId: bill.id, details: `Auto staff loss ${lossAmount} for ${staffName}` },
      })
      staffLoss = { amount: lossAmount, voucher: ref.displayReference, staffName }
    }

    // 3b) Excess — the staff collected more than the formula required (negative
    // "loss"). Requires a reason per item (shared with Cash Reconciliation) before
    // saving, and can be split across multiple reasons/people.
    let excess: { amount: number; items: number } | null = null
    if (lossAmount < 0) {
      const excessAmount = roundMoney(Math.abs(lossAmount))
      const items = excessItemsInput
        .map((it) => ({ amount: roundMoney(it.amount), reason: it.reason, staffId: it.staffId || null, personId: it.personId || null }))
        .filter((it) => it.amount > 0)
      if (items.length === 0) throw new Error('Select a reason for the excess amount collected')
      for (const it of items) {
        if (!(await isValidExcessReasonCode(it.reason))) {
          throw new Error('Select a reason for each excess amount collected')
        }
        if (it.reason === 'STAFF_TIP' && !it.staffId) throw new Error('Select the staff name for the excess amount collected')
        if (it.reason === 'CUSTOMER_EXCESS' && !it.personId) throw new Error('Select the customer name for the excess amount collected')
      }
      const itemsSum = roundMoney(items.reduce((s, it) => s + it.amount, 0))
      if (itemsSum !== excessAmount) {
        throw new Error(`Excess reasons must add up to ${excessAmount} (currently ${itemsSum})`)
      }
      const [staffRows, personRows] = await Promise.all([
        tx.user.findMany({ where: { id: { in: items.filter((i) => i.staffId).map((i) => i.staffId as string) } }, select: { id: true, name: true } }),
        tx.person.findMany({ where: { id: { in: items.filter((i) => i.personId).map((i) => i.personId as string) } }, select: { id: true, name: true } }),
      ])
      for (const it of items) {
        const recordId = crypto.randomUUID()
        const ref = await generateBillReference(tx, {
          recordId, sourceModel: 'CollectionExcess', billTypeCode: 'EXS', date: collDate, personId: it.personId, outletId: usedOutletId,
        })
        await tx.collectionExcess.create({
          data: {
            id: recordId,
            collectionId: collection.id, amount: it.amount, reason: it.reason,
            staffId: it.staffId, staffName: it.staffId ? staffRows.find((s: { id: string }) => s.id === it.staffId)?.name || null : null,
            personId: it.personId, personName: it.personId ? personRows.find((p: { id: string }) => p.id === it.personId)?.name || null : null,
            internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
          },
        })
      }
      excess = { amount: excessAmount, items: items.length }
    }

    return { collection, signedTotal, paidTotal, paidStaffLoss, signedCreated, paidCreated, staffLoss, excess }
  }, { timeout: 20000 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error saving collection' }, { status: 400 })
  }

  return NextResponse.json({ ...out.collection, creditSales: out.signedTotal, paymentsReceived: out.paidStaffLoss, staffLoss: out.staffLoss, excess: out.excess, signedCreated: out.signedCreated, paidCreated: out.paidCreated, signedTotal: out.signedTotal, paidTotal: out.paidTotal, paidStaffLoss: out.paidStaffLoss }, { status: 201 })
}
