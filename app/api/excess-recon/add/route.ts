import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { isValidExcessReasonCode } from '@/lib/excess-reasons-db'
import { generateBillReference } from '@/lib/bill-reference'

/** Attach a brand-new excess record to an existing Cash Recon day or Collection,
 *  without reopening the full Cash Recon / Collections form. Owner or an
 *  explicitly EXCESS_RECON-granted user only — there's no legacy default here. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await hasPermission(user.email, user.userId, RESOURCES.EXCESS_RECON, 'add'))) {
    return NextResponse.json({ error: 'You are not authorized to add excess records' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const source = body.source === 'COLLECTION' ? 'COLLECTION' : body.source === 'CASH_RECON' ? 'CASH_RECON' : null
  const parentId: string | undefined = body.parentId
  const amount = roundMoney(body.amount)
  const reason: string = body.reason
  if (!source) return NextResponse.json({ error: 'source must be CASH_RECON or COLLECTION' }, { status: 400 })
  if (!parentId) return NextResponse.json({ error: 'Select the day/collection to attach this excess to' }, { status: 400 })
  if (amount <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 })
  if (!(await isValidExcessReasonCode(reason))) {
    return NextResponse.json({ error: 'Select a valid reason' }, { status: 400 })
  }
  if (reason === 'STAFF_TIP' && !body.staffId) return NextResponse.json({ error: 'Select the staff name' }, { status: 400 })
  if (reason === 'CUSTOMER_EXCESS' && !body.personId) return NextResponse.json({ error: 'Select the customer name' }, { status: 400 })

  let created
  try {
    created = await prisma.$transaction(async (tx) => {
      const parent = source === 'CASH_RECON'
        ? await tx.cashRecon.findUnique({ where: { id: parentId } })
        : await tx.dailyCollection.findUnique({ where: { id: parentId } })
      if (!parent) throw new Error('That day/collection could not be found')

      const [staff, person] = await Promise.all([
        body.staffId ? tx.user.findUnique({ where: { id: body.staffId }, select: { name: true } }) : null,
        body.personId ? tx.person.findUnique({ where: { id: body.personId }, select: { name: true } }) : null,
      ])

      const data = {
        amount, reason,
        staffId: body.staffId || null, staffName: staff?.name || null,
        personId: body.personId || null, personName: person?.name || null,
      }

      const recordId = crypto.randomUUID()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any
      if (source === 'CASH_RECON') {
        const ref = await generateBillReference(tx, {
          recordId, sourceModel: 'CashReconExcess', billTypeCode: 'EXS', date: parent.date, personId: data.personId, outletId: parent.outletId,
        })
        result = await tx.cashReconExcess.create({
          data: {
            id: recordId, cashReconId: parentId, ...data,
            internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
          },
        })
        // Keep the parent's cached excess total in sync (used in its closing-balance formula).
        const agg = await tx.cashReconExcess.aggregate({ where: { cashReconId: parentId }, _sum: { amount: true } })
        await tx.cashRecon.update({ where: { id: parentId }, data: { excessAmountPaid: roundMoney(agg._sum.amount || 0) } })
      } else {
        const ref = await generateBillReference(tx, {
          recordId, sourceModel: 'CollectionExcess', billTypeCode: 'EXS', date: parent.date, personId: data.personId, outletId: parent.outletId,
        })
        result = await tx.collectionExcess.create({
          data: {
            id: recordId, collectionId: parentId, ...data,
            internalBillId: ref.internalBillId, displayReference: ref.displayReference, billTypeConfigId: ref.billTypeConfigId,
          },
        })
      }

      await tx.auditLog.create({
        data: {
          userId: user.userId, action: 'CREATE',
          entity: source === 'CASH_RECON' ? 'CashReconExcess' : 'CollectionExcess', entityId: result.id,
          details: `Added excess record ${amount} (${reason}) directly from Excess Recon`,
        },
      })

      return result
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Error adding excess record'
    const status = message === 'That day/collection could not be found' ? 404 : 400
    return NextResponse.json({ error: message }, { status })
  }

  return NextResponse.json(created, { status: 201 })
}
