import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { allocatePayment } from '@/lib/payment-alloc'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, format } from 'date-fns'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId') || user.outletId
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const where: Record<string, unknown> = {}
  if (outletId && user.role !== 'ADMIN' && user.role !== 'DIRECTOR') {
    where.outletId = outletId
  } else if (outletId) {
    where.outletId = outletId
  }
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
  const usedOutletId = outletId || user.outletId
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })

  // Prevent duplicates: one collection per staff, per outlet, per day.
  const collDate = date ? new Date(date) : new Date()
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

  const collection = await prisma.dailyCollection.create({
    data: {
      cash: roundMoney(cash),
      crdb: roundMoney(crdb),
      stanbic: roundMoney(stanbic),
      mpesa: roundMoney(mpesa),
      total,
      staffName: staffName || null,
      systemSales: roundMoney(systemSales),
      notes,
      outletId: usedOutletId,
      cashierId: user.userId,
      date: date ? new Date(date) : new Date(),
    },
    include: { outlet: true },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'DailyCollection', entityId: collection.id, details: `Total: ${total}` },
  })

  // 1) Record the staff's signed bills (credit sales: Admin/Director/Tips/DJ)
  let signedTotal = 0
  let signedCreated = 0
  for (let i = 0; i < signedInput.length; i++) {
    const sb = signedInput[i]
    const amt = roundMoney(sb.amount)
    const type = String(sb.billType || '').toUpperCase()
    if (amt <= 0 || !type || !sb.name) continue
    const person = await prisma.person.findFirst({ where: { name: sb.name, type } })
    await prisma.signedBill.create({
      data: {
        voucherNumber: `VCH-${collection.id}-${i}`,
        billType: type,
        personId: person?.id ?? null,
        personName: sb.name,
        amount: amt,
        serviceStaff: staffName || null,
        description: `Recorded during daily collection ${collection.id}`,
        status: 'UNPAID',
        date: collDate,
        outletId: usedOutletId,
        cashierId: user.userId,
      },
    })
    signedTotal += amt
    signedCreated++
  }

  // 2) Record paid bills (debt recoveries this staff collected).
  //    Only the "Staff Loss" category offsets this staff's loss; all others are
  //    recorded as normal recoveries (like the Paid Bills page) but do not.
  let paidTotal = 0
  let paidStaffLoss = 0
  let paidCreated = 0
  for (const pb of paidInput) {
    const amt = roundMoney(pb.amount)
    const method = String(pb.paymentMethod || 'CASH').toUpperCase()
    if (amt <= 0 || !method || !pb.payerName) continue
    // Allocate across the payer's outstanding bills of the same category
    // (selected first, then oldest-first); leftover becomes an unlinked credit.
    const selectedBillIds = Array.isArray(pb.selectedBillIds) ? pb.selectedBillIds : (pb.signedBillId ? [pb.signedBillId] : [])
    await allocatePayment({
      payerName: pb.payerName, category: pb.category || null, categoryBillType: pb.categoryBillType || null, totalAmount: amt,
      selectedBillIds, paymentMethod: method, outletId: usedOutletId, cashierId: user.userId,
      date: collDate, billRef: `COL-${collection.id}`, notes: `Recovery recorded during daily collection ${collection.id}`,
    })
    paidTotal += amt
    if ((pb.category || '') === 'Staff Loss') paidStaffLoss += amt
    paidCreated++
  }

  // 2b) Record cancellations linked to this collection
  for (const cn of cancelInput) {
    const qty = Number(cn.quantity) || 0
    const price = roundMoney(cn.sellingPrice)
    const reason = CANCEL_REASONS.includes(cn.reason) ? cn.reason : (cn.reason || '')
    if (!cn.productName || qty <= 0) continue
    await prisma.cancellation.create({
      data: {
        collectionId: collection.id,
        reason,
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

  // Persist the reconciliation totals on the collection (for list display + edits).
  // paymentsReceived holds the Staff-Loss-only paid total, since that is what the
  // loss formula (here and on edit) subtracts.
  await prisma.dailyCollection.update({
    where: { id: collection.id },
    data: { creditSales: roundMoney(signedTotal), paymentsReceived: roundMoney(paidStaffLoss) },
  })

  // 3) Staff Loss = System − Collection − SignedBills − PaidBills (Staff Loss only)
  const lossAmount = roundMoney((Number(systemSales) || 0) - total - signedTotal - paidStaffLoss)
  let staffLoss: { amount: number; voucher: string; staffName: string } | null = null
  if (staffName && lossAmount > 0) {
    const person = await prisma.person.findFirst({ where: { name: staffName, type: 'STAFF_LOSS' } })
    const voucherNumber = `SL-${collection.id}`
    const bill = await prisma.signedBill.create({
      data: {
        voucherNumber,
        billType: 'STAFF_LOSS',
        personId: person?.id ?? null,
        personName: staffName,
        amount: lossAmount,
        serviceStaff: staffName,
        description: `Auto staff loss: System ${Number(systemSales)} − collected ${total} − signed ${signedTotal} − paid·staffloss ${paidStaffLoss} (collection ${collection.id})`,
        status: 'UNPAID',
        date: collDate,
        outletId: usedOutletId,
        cashierId: user.userId,
      },
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'SignedBill', entityId: bill.id, details: `Auto staff loss ${lossAmount} for ${staffName}` },
    })
    staffLoss = { amount: lossAmount, voucher: voucherNumber, staffName }
  }

  return NextResponse.json({ ...collection, creditSales: signedTotal, paymentsReceived: paidStaffLoss, staffLoss, signedCreated, paidCreated, signedTotal, paidTotal, paidStaffLoss }, { status: 201 })
}
