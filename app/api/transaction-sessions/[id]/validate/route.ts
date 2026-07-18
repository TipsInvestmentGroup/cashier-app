import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { resolvePerson } from '@/lib/resolve-person'
import { generateBillReference, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'
import { allocatePayment } from '@/lib/payment-alloc'
import { syncBusinessSession } from '@/lib/business-session'

const CASHIER_ROLES = ['CASHIER', 'ACCOUNTANT', 'ADMIN']

/**
 * POST — cashier validates (or rejects) one staff member's summarized
 * transactions for this session. Body: { staffId, decision: 'VALIDATE' | 'REJECT' }.
 *
 * On VALIDATE: the staff's DECLARED/APPROVED transactions become the
 * official Daily Collection for that staff/outlet/date — no re-entry. Cash
 * and non-cash PAYMENT transactions become the DailyCollection cash/channel
 * amounts; DISCOUNT sums into discount (no dedicated model exists for
 * discounts in this app, same as the fixed Daily Collections form);
 * CANCELLATION rows each become a real Cancellation record. CREDIT_SALE and
 * SIGNED_BILL create real, bill-referenced records exactly like the fixed
 * Daily Collections form does: CREDIT_SALE creates a new SignedBill (a
 * credit sale issued today, billType CUSTOMER) and sums into creditSales;
 * SIGNED_BILL allocates the payment against the payer's outstanding signed
 * bills via lib/payment-alloc.ts (creating real PaidBill rows) and sums into
 * paymentsReceived. From here the existing collection workflow (Close Day,
 * Reporting, Finance Posting, Audit Trail, Bank Reconciliation) continues
 * completely unchanged.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CASHIER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const staffId = String(body.staffId || '')
  const decision = body.decision === 'REJECT' ? 'REJECT' : 'VALIDATE'
  if (!staffId) return NextResponse.json({ error: 'staffId required' }, { status: 400 })

  const session = await prisma.transactionSession.findUnique({ where: { id }, include: { outlet: true } })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (user.role === 'CASHIER' && session.outletId !== user.outletId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const staff = await prisma.user.findUnique({ where: { id: staffId }, select: { id: true, name: true } })
  if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

  const existingCollection = await prisma.dailyCollection.findFirst({
    where: { outletId: session.outletId, date: session.date, staffName: staff.name },
  })
  if (existingCollection) return NextResponse.json({ error: `${staff.name}'s collection for this day has already been validated` }, { status: 409 })

  if (decision === 'REJECT') {
    await prisma.staffTransaction.updateMany({
      where: { sessionId: id, staffId, status: { in: ['DECLARED', 'APPROVED'] } },
      data: { status: 'REJECTED' },
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'REJECT', entity: 'TransactionSession', entityId: id, details: `Rejected ${staff.name}'s declared transactions` },
    })
    return NextResponse.json({ ok: true, rejected: true })
  }

  const transactions = await prisma.staffTransaction.findMany({ where: { sessionId: id, staffId } })
  if (transactions.some((t) => t.status === 'PENDING_APPROVAL')) {
    return NextResponse.json({ error: `${staff.name} still has transactions pending approval` }, { status: 409 })
  }
  const usable = transactions.filter((t) => t.status === 'DECLARED' || t.status === 'APPROVED')
  if (!usable.length) return NextResponse.json({ error: 'No declared transactions to validate' }, { status: 400 })
  if (usable.some((t) => (t.category === 'SIGNED_BILL' || t.category === 'CREDIT_SALE') && !t.personName)) {
    return NextResponse.json({ error: 'Every Signed Bill / Credit Sale transaction needs a payer name before it can be validated' }, { status: 400 })
  }

  const systemSalesRow = await prisma.systemSalesRecord.findFirst({ where: { sessionId: id, staffName: staff.name } })

  let cash = 0
  let discount = 0
  const channelTotals: Record<string, number> = {}
  const cancellations: typeof usable = []
  const creditSaleTxns: typeof usable = []
  const signedBillPaymentTxns: typeof usable = []

  for (const t of usable) {
    if (t.category === 'PAYMENT') {
      if ((t.paymentMethod || 'CASH') === 'CASH') cash += t.amount
      else channelTotals[t.paymentMethod!] = roundMoney((channelTotals[t.paymentMethod!] || 0) + t.amount)
    } else if (t.category === 'CREDIT_SALE') creditSaleTxns.push(t)
    else if (t.category === 'DISCOUNT') discount += t.amount
    else if (t.category === 'SIGNED_BILL') signedBillPaymentTxns.push(t)
    else if (t.category === 'CANCELLATION') cancellations.push(t)
  }

  const digitalTotal = roundMoney(Object.values(channelTotals).reduce((s, v) => s + v, 0))
  cash = roundMoney(cash)
  const total = roundMoney(cash + digitalTotal)

  const collection = await prisma.$transaction(async (tx) => {
    const created = await tx.dailyCollection.create({
      data: {
        date: session.date,
        outletId: session.outletId,
        cashierId: user.userId,
        staffName: staff.name,
        systemSales: systemSalesRow?.amount || 0,
        cash,
        crdb: channelTotals.CRDB || 0,
        stanbic: channelTotals.STANBIC || 0,
        mpesa: channelTotals.MPESA || 0,
        total,
        discount: roundMoney(discount),
        discountReason: discount > 0 ? 'Staff-declared discount(s), see Transaction Sessions drill-down' : null,
        notes: `Validated from Transaction Session ${id}`,
      },
    })

    for (const code of Object.keys(channelTotals)) {
      await tx.dailyCollectionChannel.create({ data: { collectionId: created.id, channelCode: code, amount: channelTotals[code] } })
    }

    for (const c of cancellations) {
      await tx.cancellation.create({
        data: {
          date: session.date,
          collectionId: created.id,
          reason: 'Staff-declared cancellation',
          staffName: staff.name,
          productName: c.reference || 'N/A',
          sellingPrice: c.amount,
          quantity: 1,
          amount: c.amount,
          status: 'APPROVED',
          outletId: session.outletId,
          cashierId: user.userId,
        },
      })
    }

    // CREDIT_SALE — a brand-new signed bill issued today by the staff member,
    // same real SignedBill record the fixed Daily Collections form creates.
    let creditSales = 0
    for (const t of creditSaleTxns) {
      const amt = roundMoney(t.amount)
      const person = await resolvePerson(tx, t.personName!, 'CUSTOMER')
      const recordId = crypto.randomUUID()
      const billTypeCode = await resolveBillTypeCodeFromLegacy(tx, 'SIGNED_BILL', 'CUSTOMER')
      const ref = await generateBillReference(tx, {
        recordId, sourceModel: 'SignedBill', billTypeCode, date: session.date, personId: person?.id ?? null, outletId: session.outletId,
      })
      await tx.signedBill.create({
        data: {
          id: recordId,
          autoKey: `TXN-${t.id}`, voucherNumber: ref.displayReference, billType: 'CUSTOMER',
          personId: person?.id ?? null, personName: t.personName!, amount: amt, serviceStaff: staff.name,
          description: `Credit sale declared by ${staff.name} via Transaction Session ${id}`,
          status: 'UNPAID', date: session.date, outletId: session.outletId, cashierId: user.userId,
          internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
        },
      })
      creditSales += amt
    }

    // SIGNED_BILL — payment collected today against a bill signed earlier;
    // allocates across the payer's outstanding bills (creating real PaidBill
    // rows), same lib/payment-alloc.ts flow the fixed form uses.
    let paymentsReceived = 0
    for (const t of signedBillPaymentTxns) {
      const amt = roundMoney(t.amount)
      const person = await resolvePerson(tx, t.personName!, 'CUSTOMER')
      await allocatePayment(tx, {
        payerName: t.personName!, category: 'Customer', totalAmount: amt,
        paymentMethod: t.paymentMethod || 'CASH', outletId: session.outletId, cashierId: user.userId,
        date: session.date, billRef: `TXN-${t.id}`, personId: person?.id ?? null,
        notes: `Signed bill payment declared by ${staff.name} via Transaction Session ${id}`,
      })
      paymentsReceived += amt
    }

    const updated = await tx.dailyCollection.update({
      where: { id: created.id },
      data: { creditSales: roundMoney(creditSales), paymentsReceived: roundMoney(paymentsReceived) },
    })

    // Same reconciliation the fixed Daily Collections form runs (see
    // app/api/collections/route.ts) — without this, Excess & Loss / Excess
    // Recon would silently see nothing for collections validated through
    // Transaction Verification mode. A shortfall becomes an auto STAFF_LOSS
    // SignedBill; a surplus becomes a CollectionExcess row. There's no
    // interactive excess-reason picker in this flow (unlike the fixed form),
    // so surplus is filed under the existing UNASSIGNED reason for the
    // cashier to reclassify later via Excess Recon.
    const lossAmount = roundMoney((systemSalesRow?.amount || 0) - total - creditSales - paymentsReceived - discount)
    if (lossAmount > 0) {
      const person = await tx.person.findFirst({ where: { name: staff.name, type: 'STAFF_LOSS' } })
      const recordId = crypto.randomUUID()
      const billTypeCode = await resolveBillTypeCodeFromLegacy(tx, 'SIGNED_BILL', 'STAFF_LOSS')
      const ref = await generateBillReference(tx, {
        recordId, sourceModel: 'SignedBill', billTypeCode, date: session.date, personId: person?.id ?? null, outletId: session.outletId,
      })
      await tx.signedBill.create({
        data: {
          id: recordId,
          autoKey: `SL-${created.id}`, voucherNumber: ref.displayReference, billType: 'STAFF_LOSS',
          personId: person?.id ?? null, personName: staff.name, amount: lossAmount, serviceStaff: staff.name,
          description: `Auto staff loss: System ${systemSalesRow?.amount || 0} − collected ${total} − credit sales ${creditSales} − payments received ${paymentsReceived} − discount ${discount} (Transaction Session ${id})`,
          status: 'UNPAID', date: session.date, outletId: session.outletId, cashierId: user.userId,
          internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
          autoSourceCollectionId: created.id,
        },
      })
    } else if (lossAmount < 0) {
      const excessAmount = roundMoney(Math.abs(lossAmount))
      const recordId = crypto.randomUUID()
      const ref = await generateBillReference(tx, {
        recordId, sourceModel: 'CollectionExcess', billTypeCode: 'EXS', date: session.date, personId: null, outletId: session.outletId,
      })
      await tx.collectionExcess.create({
        data: {
          id: recordId,
          collectionId: created.id, amount: excessAmount, reason: 'UNASSIGNED', staffName: staff.name,
          internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
        },
      })
    }

    await tx.staffTransaction.updateMany({ where: { id: { in: usable.map((t) => t.id) } }, data: { status: 'APPROVED' } })

    await syncBusinessSession(tx, created.id)

    return updated
  }, { timeout: 20000 })

  const allTransactions = await prisma.staffTransaction.findMany({ where: { sessionId: id } })
  const allStaffIds = new Set(allTransactions.map((t) => t.staffId))
  const allValidated = await prisma.dailyCollection.count({ where: { outletId: session.outletId, date: session.date } })
  if (allStaffIds.size > 0 && allValidated >= allStaffIds.size) {
    await prisma.transactionSession.update({ where: { id }, data: { status: 'VALIDATED', validatedById: user.userId, validatedAt: new Date() } })
  }

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'DailyCollection', entityId: collection.id, details: `Validated ${staff.name}'s Transaction Session declarations into an official collection` },
  })

  return NextResponse.json({ ok: true, collection })
}
