import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { generateVoucherNumber } from '@/lib/utils'

const CAN_WRITE = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId')
  const billType = searchParams.get('billType')
  const status = searchParams.get('status')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId
  else if (user.outletId && !['ADMIN', 'DIRECTOR', 'MANAGER', 'ACCOUNTANT'].includes(user.role)) {
    where.outletId = user.outletId
  }
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

  const usedOutletId = outletId || user.outletId
  if (!usedOutletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })

  // Optional product line items. When present, the bill amount is their sum.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const itemsInput: any[] = Array.isArray(body.items)
    ? body.items.filter((it: { productName?: string; quantity?: number }) => it.productName && Number(it.quantity) > 0)
    : []
  const itemsTotal = itemsInput.reduce((s, it) => s + (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0), 0)
  const finalAmount = itemsInput.length ? itemsTotal : Number(amount)

  const voucherNumber = generateVoucherNumber()

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

  const bill = await prisma.signedBill.create({
    data: {
      billType,
      personId: personId || null,
      personName,
      amount: finalAmount,
      serviceStaff,
      description,
      dueDate: dueDate ? new Date(dueDate) : null,
      voucherNumber,
      outletId: usedOutletId,
      cashierId: user.userId,
      date: date ? new Date(date) : new Date(),
    },
    include: { outlet: true, person: true },
  })

  // Create the line items
  for (const it of itemsInput) {
    const qty = Number(it.quantity) || 0
    const price = Number(it.unitPrice) || 0
    await prisma.billItem.create({
      data: {
        signedBillId: bill.id, productId: it.productId || null, productName: it.productName,
        unitPrice: price, quantity: qty, amount: price * qty,
      },
    })
  }

  return NextResponse.json({ ...bill, limitExceeded, exceededAmount }, { status: 201 })
}
