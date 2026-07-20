import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { isValidExcessReasonCode, excessReasonCategoryDb } from '@/lib/excess-reasons-db'
import { classForReason } from '@/lib/reconciliation-classification'
import { UNASSIGNED_EXCESS_REASON } from '@/lib/excess-reasons'
import { postJournalEntry } from '@/lib/ledger'
import { resolveAccountId, resolveChannelAccountId, resolveDefaultCompanyId } from '@/lib/finance-mapping'

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
    // Reverse the settlement GL if one was posted (COLLECTION-source PAYABLE):
    // re-establish the liability — Dr Cash / Cr Excess-Payable.
    const reverseGl = source === 'COLLECTION' && existing.paidAmount > 0 && classForReason(existing.reason, existing.category) === 'PAYABLE'
    const priorPaid = existing.paidAmount
    const updated = await prisma.$transaction(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txModel = (source === 'CASH_RECON' ? tx.cashReconExcess : tx.collectionExcess) as any
      const upd = await txModel.update({ where: { id }, data: { paidAmount: 0, paidAt: null } })
      if (reverseGl) {
        const coll = await tx.collectionExcess.findUnique({ where: { id }, include: { collection: { include: { outlet: true } } } })
        const outletId = coll?.collection.outletId
        const companyId = coll?.collection.outlet?.companyId || (await resolveDefaultCompanyId(tx))
        if (companyId && outletId) {
          const cashAccountId = await resolveChannelAccountId(tx, { companyId, channelCode: existing.channelCode || 'CASH', outletId })
          const excessPayableAccountId = await resolveAccountId(tx, { companyId, key: 'EXCESS_PAYABLE' })
          await postJournalEntry(tx, {
            companyId, entryDate: new Date(), sourceModule: 'COLLECTIONS', sourceType: 'ExcessSettlementReversal', sourceId: id,
            description: `Excess payout reversal — collection excess ${id}`, createdById: user.userId,
            lines: [
              { accountId: cashAccountId, debit: priorPaid, outletId },
              { accountId: excessPayableAccountId, credit: priorPaid, outletId },
            ],
          })
        }
      }
      await tx.auditLog.create({
        data: {
          userId: user.userId, action: 'UPDATE',
          entity: source === 'CASH_RECON' ? 'CashReconExcess' : 'CollectionExcess', entityId: id,
          details: `Unsettled excess payment — reset paid ${priorPaid} back to 0${reverseGl ? ' — posted Dr Cash / Cr Excess-Payable reversal' : ''}`,
        },
      })
      return upd
    })
    return NextResponse.json({ ...updated, balance: roundMoney(updated.amount - updated.paidAmount) })
  }

  if (!ALLOWED.includes(user.role) && !(await hasPermission(user.email, user.userId, RESOURCES.EXCESS_RECON, 'settle'))) {
    return NextResponse.json({ error: 'You are not authorized to settle excess payments' }, { status: 403 })
  }
  // Classification gate: a difference must be classified before money moves
  // against it — an UNASSIGNED ("Needs reason") row has no accounting meaning
  // yet, so block settling it until an accountant assigns a real reason.
  if (existing.reason === UNASSIGNED_EXCESS_REASON) {
    return NextResponse.json({ error: 'Assign a Difference Reason before settling this record — it is still unclassified.' }, { status: 400 })
  }
  const amount = roundMoney(body.amount)
  if (amount <= 0) return NextResponse.json({ error: 'Payment amount must be greater than zero' }, { status: 400 })

  const balance = roundMoney(existing.amount - existing.paidAmount)
  if (amount > balance) {
    return NextResponse.json({ error: `Payment ${amount} exceeds the remaining balance of ${balance}` }, { status: 400 })
  }

  const newPaid = roundMoney(existing.paidAmount + amount)
  // A COLLECTION-source PAYABLE over-collection accrued to Excess-Payable at
  // collection time; paying it out now relieves that liability against cash:
  //   Dr Excess-Payable  Cr Cash/channel.
  // Cash-recon excess and non-PAYABLE rows keep their prior non-GL behavior
  // (cash-recon excess is a different economic event — see D10, deferred).
  const postGl = source === 'COLLECTION' && classForReason(existing.reason, existing.category) === 'PAYABLE'
  const updated = await prisma.$transaction(async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txModel = (source === 'CASH_RECON' ? tx.cashReconExcess : tx.collectionExcess) as any
    const upd = await txModel.update({ where: { id }, data: { paidAmount: newPaid, paidAt: new Date() } })
    if (postGl) {
      const coll = await tx.collectionExcess.findUnique({ where: { id }, include: { collection: { include: { outlet: true } } } })
      const outletId = coll?.collection.outletId
      const companyId = coll?.collection.outlet?.companyId || (await resolveDefaultCompanyId(tx))
      if (companyId && outletId) {
        const cashAccountId = await resolveChannelAccountId(tx, { companyId, channelCode: existing.channelCode || 'CASH', outletId })
        const excessPayableAccountId = await resolveAccountId(tx, { companyId, key: 'EXCESS_PAYABLE' })
        await postJournalEntry(tx, {
          companyId, entryDate: new Date(), sourceModule: 'COLLECTIONS', sourceType: 'ExcessSettlement', sourceId: id,
          description: `Excess payout — collection excess ${id}`, createdById: user.userId,
          lines: [
            { accountId: excessPayableAccountId, debit: amount, outletId },
            { accountId: cashAccountId, credit: amount, outletId },
          ],
        })
      }
    }
    await tx.auditLog.create({
      data: {
        userId: user.userId, action: 'UPDATE',
        entity: source === 'CASH_RECON' ? 'CashReconExcess' : 'CollectionExcess', entityId: id,
        details: `Excess payment ${amount} recorded (paid ${newPaid} of ${existing.amount})${postGl ? ' — posted Dr Excess-Payable / Cr Cash' : ''}`,
      },
    })
    return upd
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
    if (!(await isValidExcessReasonCode(body.reason))) {
      return NextResponse.json({ error: 'Select a valid reason' }, { status: 400 })
    }
    data.reason = body.reason
    data.category = (await excessReasonCategoryDb(body.reason)) || 'NON_PAYABLE'
    data.accountingClass = classForReason(body.reason, data.category)
  }
  if (body.notes !== undefined) data.notes = String(body.notes).trim() || null
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
