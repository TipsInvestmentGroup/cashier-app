import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { EXCESS_REASON_VALUES, UNASSIGNED_EXCESS_REASON } from '@/lib/excess-reasons'

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
  if (!EXCESS_REASON_VALUES.includes(reason) || reason === UNASSIGNED_EXCESS_REASON) {
    return NextResponse.json({ error: 'Select a valid reason' }, { status: 400 })
  }
  if (reason === 'STAFF_TIP' && !body.staffId) return NextResponse.json({ error: 'Select the staff name' }, { status: 400 })
  if (reason === 'CUSTOMER_EXCESS' && !body.personId) return NextResponse.json({ error: 'Select the customer name' }, { status: 400 })

  const parent = source === 'CASH_RECON'
    ? await prisma.cashRecon.findUnique({ where: { id: parentId } })
    : await prisma.dailyCollection.findUnique({ where: { id: parentId } })
  if (!parent) return NextResponse.json({ error: 'That day/collection could not be found' }, { status: 404 })

  const [staff, person] = await Promise.all([
    body.staffId ? prisma.user.findUnique({ where: { id: body.staffId }, select: { name: true } }) : null,
    body.personId ? prisma.person.findUnique({ where: { id: body.personId }, select: { name: true } }) : null,
  ])

  const data = {
    amount, reason,
    staffId: body.staffId || null, staffName: staff?.name || null,
    personId: body.personId || null, personName: person?.name || null,
  }

  let created
  if (source === 'CASH_RECON') {
    created = await prisma.cashReconExcess.create({ data: { cashReconId: parentId, ...data } })
    // Keep the parent's cached excess total in sync (used in its closing-balance formula).
    const agg = await prisma.cashReconExcess.aggregate({ where: { cashReconId: parentId }, _sum: { amount: true } })
    await prisma.cashRecon.update({ where: { id: parentId }, data: { excessAmountPaid: roundMoney(agg._sum.amount || 0) } })
  } else {
    created = await prisma.collectionExcess.create({ data: { collectionId: parentId, ...data } })
  }

  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'CREATE',
      entity: source === 'CASH_RECON' ? 'CashReconExcess' : 'CollectionExcess', entityId: created.id,
      details: `Added excess record ${amount} (${reason}) directly from Excess Recon`,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
