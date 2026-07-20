import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, NO_OUTLET, writeOutletId } from '@/lib/auth'
import { allocatePayment } from '@/lib/payment-alloc'
import { roundMoney } from '@/lib/utils'
import { isValidExcessReasonCode, excessReasonCategoryDb } from '@/lib/excess-reasons-db'
import { sumChannelAmounts, legacyFixedFields, syncCollectionChannels, primaryChannelFromAmounts } from '@/lib/collection-channels'
import { generateBillReference, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'
import { resolveBusinessDate, resolveEffectiveConfig } from '@/lib/business-calendar'
import { resolvePerson } from '@/lib/resolve-person'
import { syncBusinessSession } from '@/lib/business-session'
import { postJournalEntry } from '@/lib/ledger'
import { resolveAccountId, resolveDefaultCompanyId, resolveChannelAccountId } from '@/lib/finance-mapping'
import { postCreditSale } from '@/lib/finance-ar'
import { startOfDay, endOfDay, format } from 'date-fns'

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
  const excessItemsInput: { amount: number; reason: string; staffId?: string; personId?: string; notes?: string }[] = Array.isArray(body.excessItems) ? body.excessItems : []

  const total = roundMoney(Number(cash) + sumChannelAmounts(channelAmounts))
  const usedOutletId = writeOutletId(user, outletId)
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })

  // Prevent duplicates: one collection per staff, per outlet, per day.
  const effectiveCalendar = await resolveEffectiveConfig({ outletId: usedOutletId })
  const collDate = date ? new Date(date) : resolveBusinessDate(new Date(), effectiveCalendar)

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

  // Resolve every referenced Difference Reason's category BEFORE opening the
  // transaction below. isValidExcessReasonCode/excessReasonCategoryDb read
  // (and, on a cold cache, write-seed) the ExcessReason table through the
  // plain `prisma` client — calling them from inside the `tx` transaction
  // would have that write contend for the same SQLite connection's write
  // lock that `tx` already holds, deadlocking until the transaction's own
  // timeout aborts it. Resolving up front avoids that entirely.
  const referencedReasons = Array.from(new Set(excessItemsInput.map((it) => it.reason).filter(Boolean)))
  const reasonCategoryMap = new Map<string, string>()
  for (const reason of referencedReasons) {
    if (!(await isValidExcessReasonCode(reason))) {
      return NextResponse.json({ error: 'Select a valid Difference Reason for each line' }, { status: 400 })
    }
    const category = await excessReasonCategoryDb(reason)
    if (!category) return NextResponse.json({ error: 'Select a valid Difference Reason for each line' }, { status: 400 })
    reasonCategoryMap.set(reason, category)
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
      data: {
        userId: user.userId, action: 'CREATE', entity: 'DailyCollection', entityId: collection.id,
        details: JSON.stringify({ snapshot: { total, staffName: staffName || null, cash: roundMoney(cash), systemSales: roundMoney(systemSales), date: collDate.toISOString() } }),
      },
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
      const createdSignedBill = await tx.signedBill.create({
        data: {
          id: recordId,
          autoKey: `VCH-${collection.id}-${i}`, voucherNumber: ref.displayReference, billType: type, personId: person?.id ?? null, personName: sb.name,
          amount: amt, serviceStaff: staffName || null, description: `Recorded during daily collection ${collection.id}`,
          status: 'UNPAID', date: collDate, outletId: usedOutletId, cashierId: user.userId,
          internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
        },
      })
      // Finance Platform (Stage 2): posts Dr AR / Cr Sales Revenue for
      // CUSTOMER/ADMIN/DIRECTOR (immediately real); no-ops for TIPS/DJ until
      // approved and for any other type.
      await postCreditSale(tx, createdSignedBill, user.userId)
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

    // 3) Difference = System Sales − Collection − SignedBills − PaidBills (Staff Loss only) − Discount.
    // Positive = shortfall (collected less than System Sales), negative = surplus
    // (collected more). Any non-zero difference needs a Difference Reason before
    // saving (generalizes "split across multiple reasons/people" — a single
    // reason is just a one-item split). Each item's reason resolves to a
    // category that decides the side effect:
    //   PAYABLE_EXCESS → CollectionExcess row, settled later via Excess Payment.
    //   STAFF_LOSS     → the pre-existing auto-SignedBill debt path, unchanged.
    //   NON_PAYABLE    → CollectionExcess row too (uniform audit trail), but
    //                    excluded from Excess Recon's payable views/actions.
    const lossAmount = roundMoney((Number(systemSales) || 0) - total - signedTotal - paidStaffLoss - discount)
    let staffLoss: { amount: number; voucher: string; staffName: string } | null = null
    let excess: { amount: number; items: number } | null = null
    // "The" payment channel this collection's money came in through, for
    // auto-inheriting onto any payable excess record (no re-entry needed).
    const primaryChannelCode = primaryChannelFromAmounts(Number(cash) || 0, channelAmounts)

    if (lossAmount !== 0) {
      const differenceAmount = roundMoney(Math.abs(lossAmount))
      const items = excessItemsInput
        .map((it) => ({ amount: roundMoney(it.amount), reason: it.reason, staffId: it.staffId || null, personId: it.personId || null, notes: it.notes?.trim() || null }))
        .filter((it) => it.amount > 0)
      if (items.length === 0) {
        throw new Error(
          Number(systemSales) > 0 && total === 0
            ? 'System Sales exist but no collections were recorded. Please select a Difference Reason before saving.'
            : 'There is a difference between System Sales and Collections. Please select a Difference Reason before saving.'
        )
      }
      const categories = reasonCategoryMap
      for (const it of items) {
        if (!categories.has(it.reason)) {
          throw new Error('Select a valid Difference Reason for each line')
        }
        if (it.reason === 'STAFF_TIP' && !it.staffId) throw new Error('Select the staff name for the Staff Tip line')
        if (it.reason === 'CUSTOMER_EXCESS' && !it.personId) throw new Error('Select the customer name for the Customer Excess line')
      }
      const itemsSum = roundMoney(items.reduce((s, it) => s + it.amount, 0))
      if (itemsSum !== differenceAmount) {
        throw new Error(`Difference Reasons must add up to ${differenceAmount} (currently ${itemsSum})`)
      }
      const [staffRows, personRows] = await Promise.all([
        tx.user.findMany({ where: { id: { in: items.filter((i) => i.staffId).map((i) => i.staffId as string) } }, select: { id: true, name: true } }),
        tx.person.findMany({ where: { id: { in: items.filter((i) => i.personId).map((i) => i.personId as string) } }, select: { id: true, name: true } }),
      ])

      let payableItemCount = 0
      let staffLossFromItems = 0
      for (const it of items) {
        const category = categories.get(it.reason)!
        if (category === 'STAFF_LOSS') {
          staffLossFromItems += it.amount
          continue
        }
        const recordId = crypto.randomUUID()
        const ref = await generateBillReference(tx, {
          recordId, sourceModel: 'CollectionExcess', billTypeCode: 'EXS', date: collDate, personId: it.personId, outletId: usedOutletId,
        })
        await tx.collectionExcess.create({
          data: {
            id: recordId,
            collectionId: collection.id, amount: it.amount, reason: it.reason, category, channelCode: primaryChannelCode, notes: it.notes,
            staffId: it.staffId, staffName: it.staffId ? staffRows.find((s: { id: string }) => s.id === it.staffId)?.name || null : (staffName || null),
            personId: it.personId, personName: it.personId ? personRows.find((p: { id: string }) => p.id === it.personId)?.name || null : null,
            internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
          },
        })
        if (category === 'PAYABLE_EXCESS') payableItemCount++
      }
      if (payableItemCount > 0) excess = { amount: roundMoney(items.filter((it) => categories.get(it.reason) === 'PAYABLE_EXCESS').reduce((s, it) => s + it.amount, 0)), items: payableItemCount }

      if (staffLossFromItems > 0 && staffName) {
        const staffLossAmount = roundMoney(staffLossFromItems)
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
            amount: staffLossAmount, serviceStaff: staffName,
            description: `Staff loss (Difference Reason): System ${Number(systemSales)} − collected ${total} − signed ${signedTotal} − paid·staffloss ${paidStaffLoss} − discount ${discount} (collection ${collection.id})`,
            status: 'UNPAID', date: collDate, outletId: usedOutletId, cashierId: user.userId,
            internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
            autoSourceCollectionId: collection.id,
          },
        })
        await tx.auditLog.create({
          data: { userId: user.userId, action: 'CREATE', entity: 'SignedBill', entityId: bill.id, details: `Auto staff loss ${staffLossAmount} for ${staffName}` },
        })
        await postCreditSale(tx, bill, user.userId) // no-op: STAFF_LOSS isn't a CREDIT_BILL_TYPES receivable
        staffLoss = { amount: staffLossAmount, voucher: ref.displayReference, staffName }
      }
    }

    await syncBusinessSession(tx, collection.id)

    // Finance Platform (Phase 1): post the cash-in side of this collection —
    // Dr Cash/Bank/Mobile-Money (per channel) / Cr Sales Revenue. A channel
    // with its own glAccountId set posts there; otherwise it falls back to
    // the company's default Cash/Mobile-Money account via
    // resolveAccountId(), so an unconfigured company still posts correctly.
    const companyId = collection.outlet.companyId || (await resolveDefaultCompanyId(tx))
    if (companyId && total > 0) {
      const amountsByCode: Record<string, number> = { CASH: roundMoney(Number(cash) || 0), ...channelAmounts }
      const debitLines: { accountId: string; debit: number; outletId: string }[] = []
      const accountTotals = new Map<string, number>()
      for (const [code, rawAmount] of Object.entries(amountsByCode)) {
        const channelAmount = roundMoney(Number(rawAmount) || 0)
        if (channelAmount <= 0) continue
        const accountId = await resolveChannelAccountId(tx, { companyId, channelCode: code, outletId: usedOutletId })
        accountTotals.set(accountId, roundMoney((accountTotals.get(accountId) || 0) + channelAmount))
      }
      for (const [accountId, amount] of accountTotals) debitLines.push({ accountId, debit: amount, outletId: usedOutletId })

      if (debitLines.length) {
        const salesRevenueAccountId = await resolveAccountId(tx, { companyId, key: 'SALES_REVENUE' })
        await postJournalEntry(tx, {
          companyId, entryDate: collDate, sourceModule: 'COLLECTIONS', sourceType: 'DailyCollection', sourceId: collection.id,
          description: `Daily collection ${collection.id}`, createdById: user.userId,
          lines: [...debitLines, { accountId: salesRevenueAccountId, credit: total, outletId: usedOutletId }],
        })
      }
    }

    return { collection, signedTotal, paidTotal, paidStaffLoss, signedCreated, paidCreated, staffLoss, excess }
  }, { timeout: 20000 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Error saving collection' }, { status: 400 })
  }

  return NextResponse.json({ ...out.collection, creditSales: out.signedTotal, paymentsReceived: out.paidStaffLoss, staffLoss: out.staffLoss, excess: out.excess, signedCreated: out.signedCreated, paidCreated: out.paidCreated, signedTotal: out.signedTotal, paidTotal: out.paidTotal, paidStaffLoss: out.paidStaffLoss }, { status: 201 })
}
