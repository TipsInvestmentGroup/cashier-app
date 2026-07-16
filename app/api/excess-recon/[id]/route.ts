import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { EXCESS_REASON_VALUES, UNASSIGNED_EXCESS_REASON } from '@/lib/excess-reasons'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']

type Source = 'CASH_RECON' | 'COLLECTION'

function parseSource(v: unknown): Source | null {
  return v === 'COLLECTION' ? 'COLLECTION' : v === 'CASH_RECON' ? 'CASH_RECON' : null
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function modelFor(source: Source): any {
  return source === 'CASH_RECON' ? prisma.cashReconExcess : prisma.collectionExcess
}

/** Record a payment against an excess item, or (body.unsettle) reset it back to fully unpaid. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const source = parseSource(body.source)
  if (!source) return NextResponse.json({ error: 'source must be CASH_RECON or COLLECTION' }, { status: 400 })
  const model = modelFor(source)
  const existing = await model.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Excess item not found' }, { status: 404 })

  if (body.unsettle) {
    if (!(await hasPermission(user.email, user.userId, RESOURCES.EXCESS_RECON, 'unsettle'))) {
      return NextResponse.json({ error: 'You are not authorized to unsettle excess payments' }, { status: 403 })
    }
    const updated = await model.update({ where: { id }, data: { paidAmount: 0 } })
    await prisma.auditLog.create({
      data: {
        userId: user.userId, action: 'UPDATE',
        entity: source === 'CASH_RECON' ? 'CashReconExcess' : 'CollectionExcess', entityId: id,
        details: `Unsettled excess payment — reset paid ${existing.paidAmount} back to 0`,
      },
    })
    return NextResponse.json({ ...updated, balance: roundMoney(updated.amount - updated.paidAmount) })
  }

  if (!ALLOWED.includes(user.role) && !(await hasPermission(user.email, user.userId, RESOURCES.EXCESS_RECON, 'settle'))) {
    return NextResponse.json({ error: 'You are not authorized to settle excess payments' }, { status: 403 })
  }
  const amount = roundMoney(body.amount)
  if (amount <= 0) return NextResponse.json({ error: 'Payment amount must be greater than zero' }, { status: 400 })

  const balance = roundMoney(existing.amount - existing.paidAmount)
  if (amount > balance) {
    return NextResponse.json({ error: `Payment ${amount} exceeds the remaining balance of ${balance}` }, { status: 400 })
  }

  const newPaid = roundMoney(existing.paidAmount + amount)
  const updated = await model.update({ where: { id }, data: { paidAmount: newPaid } })

  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'UPDATE',
      entity: source === 'CASH_RECON' ? 'CashReconExcess' : 'CollectionExcess', entityId: id,
      details: `Excess payment ${amount} recorded (paid ${newPaid} of ${existing.amount})`,
    },
  })

  return NextResponse.json({ ...updated, balance: roundMoney(updated.amount - updated.paidAmount) })
}

/** Edit an excess record's amount/reason/staff/person. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPermission(user.email, user.userId, RESOURCES.EXCESS_RECON, 'edit'))) {
    return NextResponse.json({ error: 'You are not authorized to edit excess records' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const source = parseSource(body.source)
  if (!source) return NextResponse.json({ error: 'source must be CASH_RECON or COLLECTION' }, { status: 400 })
  const model = modelFor(source)
  const existing = await model.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Excess item not found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.amount !== undefined) {
    const amount = roundMoney(body.amount)
    if (amount < existing.paidAmount) return NextResponse.json({ error: `Amount cannot be less than the ${existing.paidAmount} already paid` }, { status: 400 })
    data.amount = amount
  }
  if (body.reason !== undefined) {
    if (!EXCESS_REASON_VALUES.includes(body.reason) || body.reason === UNASSIGNED_EXCESS_REASON) {
      return NextResponse.json({ error: 'Select a valid reason' }, { status: 400 })
    }
    data.reason = body.reason
  }
  const reason = body.reason !== undefined ? body.reason : existing.reason
  if (body.staffId !== undefined || reason === 'STAFF_TIP') {
    if (reason === 'STAFF_TIP' && !body.staffId && !existing.staffId) return NextResponse.json({ error: 'Select the staff name' }, { status: 400 })
    if (body.staffId !== undefined) {
      const staff = body.staffId ? await prisma.user.findUnique({ where: { id: body.staffId }, select: { name: true } }) : null
      data.staffId = body.staffId || null
      data.staffName = staff?.name || null
      data.personId = null
      data.personName = null
    }
  }
  if (body.personId !== undefined || reason === 'CUSTOMER_EXCESS') {
    if (reason === 'CUSTOMER_EXCESS' && !body.personId && !existing.personId) return NextResponse.json({ error: 'Select the customer name' }, { status: 400 })
    if (body.personId !== undefined) {
      const person = body.personId ? await prisma.person.findUnique({ where: { id: body.personId }, select: { name: true } }) : null
      data.personId = body.personId || null
      data.personName = person?.name || null
      data.staffId = null
      data.staffName = null
    }
  }

  const updated = await model.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'UPDATE',
      entity: source === 'CASH_RECON' ? 'CashReconExcess' : 'CollectionExcess', entityId: id,
      details: `Edited excess record (amount ${updated.amount}, reason ${updated.reason})`,
    },
  })
  return NextResponse.json({ ...updated, balance: roundMoney(updated.amount - updated.paidAmount) })
}

/** Delete an excess record outright. Blocked once any payment has been recorded. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPermission(user.email, user.userId, RESOURCES.EXCESS_RECON, 'delete'))) {
    return NextResponse.json({ error: 'You are not authorized to delete excess records' }, { status: 403 })
  }

  const { id } = await params
  const source = parseSource(new URL(req.url).searchParams.get('source'))
  if (!source) return NextResponse.json({ error: 'source must be CASH_RECON or COLLECTION' }, { status: 400 })
  const model = modelFor(source)
  const existing = await model.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Excess item not found' }, { status: 404 })
  if (existing.paidAmount > 0) {
    return NextResponse.json({ error: 'This excess record has payments recorded — unsettle it first before deleting' }, { status: 409 })
  }

  await model.delete({ where: { id } })
  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'DELETE',
      entity: source === 'CASH_RECON' ? 'CashReconExcess' : 'CollectionExcess', entityId: id,
      details: `Deleted excess record (${existing.amount})`,
    },
  })
  return NextResponse.json({ ok: true })
}
