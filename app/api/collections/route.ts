import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, NO_OUTLET, writeOutletId } from '@/lib/auth'
import { allocatePayment } from '@/lib/payment-alloc'
import { roundMoney } from '@/lib/utils'
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
    include: { outlet: true, cashier: { select: { name: true } }, cancellations: true },
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
  const { cash = 0, crdb = 0, stanbic = 0, mpesa = 0, notes, outletId, date, staffName, systemSales = 0 } = body
  // Reconciliation inputs entered during the collection flow
  const signedInput: { billType: string; name: string; amount: number }[] = Array.isArray(body.signedBills) ? body.signedBills : []
  const paidInput: { payerName: string; amount: number; paymentMethod: string; category?: string; categoryBillType?: string; signedBillId?: string; selectedBillIds?: string[] }[] = Array.isArray(body.paidBills) ? body.paidBills : []
  const cancelInput: { reason: string; productId?: string; productName: string; sellingPrice: number; quantity: number; amount: number }[] = Array.isArray(body.cancellations) ? body.cancellations : []
  const CANCEL_REASONS = ['Double Punch', 'Out of Stock', 'Wrong Punch']

  const total = roundMoney(Number(cash) + Number(crdb) + Number(stanbic) + Number(mpesa))
  const usedOutletId = writeOutletId(user, outletId)
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })

  // Prevent duplicates: one collection per staff, per outlet, per day.
  const collDate = date ? new Date(date) : new Date()

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
  const out = await prisma.$transaction(async (tx) => {
    const collection = await tx.dailyCollection.create({
      data: {
        cash: roundMoney(cash), crdb: roundMoney(crdb), stanbic: roundMoney(stanbic), mpesa: roundMoney(mpesa),
        total, staffName: staffName || null, systemSales: roundMoney(systemSales),
        notes, outletId: usedOutletId, cashierId: user.userId, date: date ? new Date(date) : new Date(),
      },
      include: { outlet: true },
    })

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
      const person = await tx.person.findFirst({ where: { name: sb.name, type } })
      await tx.signedBill.create({
        data: {
          voucherNumber: `VCH-${collection.id}-${i}`, billType: type, personId: person?.id ?? null, personName: sb.name,
          amount: amt, serviceStaff: staffName || null, description: `Recorded during daily collection ${collection.id}`,
          status: 'UNPAID', date: collDate, outletId: usedOutletId, cashierId: user.userId,
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
      const reason = CANCEL_REASONS.includes(cn.reason) ? cn.reason : (cn.reason || '')
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

    // 3) Staff Loss = System − Collection − SignedBills − PaidBills (Staff Loss only)
    const lossAmount = roundMoney((Number(systemSales) || 0) - total - signedTotal - paidStaffLoss)
    let staffLoss: { amount: number; voucher: string; staffName: string } | null = null
    if (staffName && lossAmount > 0) {
      const person = await tx.person.findFirst({ where: { name: staffName, type: 'STAFF_LOSS' } })
      const voucherNumber = `SL-${collection.id}`
      const bill = await tx.signedBill.create({
        data: {
          voucherNumber, billType: 'STAFF_LOSS', personId: person?.id ?? null, personName: staffName,
          amount: lossAmount, serviceStaff: staffName,
          description: `Auto staff loss: System ${Number(systemSales)} − collected ${total} − signed ${signedTotal} − paid·staffloss ${paidStaffLoss} (collection ${collection.id})`,
          status: 'UNPAID', date: collDate, outletId: usedOutletId, cashierId: user.userId,
        },
      })
      await tx.auditLog.create({
        data: { userId: user.userId, action: 'CREATE', entity: 'SignedBill', entityId: bill.id, details: `Auto staff loss ${lossAmount} for ${staffName}` },
      })
      staffLoss = { amount: lossAmount, voucher: voucherNumber, staffName }
    }

    return { collection, signedTotal, paidTotal, paidStaffLoss, signedCreated, paidCreated, staffLoss }
  }, { timeout: 20000 })

  return NextResponse.json({ ...out.collection, creditSales: out.signedTotal, paymentsReceived: out.paidStaffLoss, staffLoss: out.staffLoss, signedCreated: out.signedCreated, paidCreated: out.paidCreated, signedTotal: out.signedTotal, paidTotal: out.paidTotal, paidStaffLoss: out.paidStaffLoss }, { status: 201 })
}
