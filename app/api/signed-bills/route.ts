import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, readOutletScope, writeOutletId } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { generateBillReference, resolveBillTypeCodeFromLegacy } from '@/lib/bill-reference'

const CAN_WRITE = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CAN_WRITE.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  // Cashiers are strictly locked to their own outlet.
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const billType = searchParams.get('billType')
  const status = searchParams.get('status')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId
  if (billType) where.billType = billType
  if (status) where.status = status
  if (startDate && endDate) {
    where.date = { gte: new Date(startDate), lte: new Date(endDate) }
  }

  const bills = await prisma.signedBill.findMany({
    where,
    include: {
      outlet: true,
      cashier: { select: { name: true } },
      person: true,
      payments: true,
    },
    orderBy: { date: 'desc' },
    take: 200,
  })

  // Per-person sequence number (1..N) by signing order — friendly alternative to voucher
  const all = await prisma.signedBill.findMany({
    select: { id: true, personId: true, personName: true },
    orderBy: { createdAt: 'asc' },
  })
  const seqMap = new Map<string, number>()
  const counter = new Map<string, number>()
  for (const b of all) {
    const k = b.personId || `name:${b.personName}`
    const n = (counter.get(k) || 0) + 1
    counter.set(k, n)
    seqMap.set(b.id, n)
  }
  const withSeq = bills.map((b) => ({ ...b, seq: seqMap.get(b.id) || null }))

  return NextResponse.json(withSeq)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CAN_WRITE)) return NextResponse.json({ error: 'You are not authorized to create signed bills' }, { status: 403 })

  const body = await req.json()
  const {
    billType, personId, personName, amount, serviceStaff,
    description, dueDate, outletId, date,
  } = body

  const usedOutletId = writeOutletId(user, outletId)
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })

  // Optional product line items. When present, the bill amount is their sum.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemsInput: any[] = Array.isArray(body.items)
    ? body.items.filter((it: { productName?: string; quantity?: number }) => it.productName && Number(it.quantity) > 0)
    : []
  const itemsTotal = roundMoney(itemsInput.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0))
  const finalAmount = roundMoney(itemsInput.length ? itemsTotal : Number(amount))

  let limitExceeded = false
  let exceededAmount = 0

  if (personId && ['ADMIN', 'DIRECTOR'].includes(billType)) {
    const person = await prisma.person.findUnique({ where: { id: personId } })
    if (person && person.creditLimit > 0) {
      const outstanding = await prisma.signedBill.aggregate({
        where: { personId, status: { not: 'PAID' } },
        _sum: { amount: true },
      })
      const totalOwed = (outstanding._sum.amount || 0) + finalAmount
      if (totalOwed > person.creditLimit) {
        limitExceeded = true
        exceededAmount = totalOwed - person.creditLimit
      }
    }
  }

  const billDate = date ? new Date(date) : new Date()

  const bill = await prisma.$transaction(async (tx) => {
    const recordId = crypto.randomUUID()
    const billTypeCode = await resolveBillTypeCodeFromLegacy(tx, 'SIGNED_BILL', billType)
    const ref = await generateBillReference(tx, {
      recordId, sourceModel: 'SignedBill', billTypeCode, date: billDate, personId: personId || null, outletId: usedOutletId,
    })

    const created = await tx.signedBill.create({
      data: {
        id: recordId,
        billType,
        personId: personId || null,
        personName,
        amount: finalAmount,
        serviceStaff,
        description,
        dueDate: dueDate ? new Date(dueDate) : null,
        voucherNumber: ref.displayReference,
        internalBillId: ref.internalBillId,
        displayReference: ref.displayReference,
        billTypeConfigId: ref.billTypeConfigId,
        outletId: usedOutletId,
        cashierId: user.userId,
        date: billDate,
      },
      include: { outlet: true, person: true },
    })

    // Create the line items
    for (const it of itemsInput) {
      const qty = Number(it.quantity) || 0
      const price = roundMoney(it.unitPrice)
      await tx.billItem.create({
        data: {
          signedBillId: created.id, productId: it.productId || null, productName: it.productName,
          unitPrice: price, quantity: qty, amount: roundMoney(price * qty),
        },
      })
    }

    return created
  })

  return NextResponse.json({ ...bill, limitExceeded, exceededAmount }, { status: 201 })
}
