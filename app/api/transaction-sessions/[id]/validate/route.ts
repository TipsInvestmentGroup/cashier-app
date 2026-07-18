import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'

const CASHIER_ROLES = ['CASHIER', 'ACCOUNTANT', 'ADMIN']

/**
 * POST — cashier validates (or rejects) one staff member's summarized
 * transactions for this session. Body: { staffId, decision: 'VALIDATE' | 'REJECT' }.
 *
 * On VALIDATE: the staff's DECLARED/APPROVED transactions become the
 * official Daily Collection for that staff/outlet/date — no re-entry. Cash
 * and non-cash PAYMENT transactions become the DailyCollection cash/channel
 * amounts; CREDIT_SALE sums into creditSales; DISCOUNT sums into discount;
 * SIGNED_BILL sums into paymentsReceived (payments collected against
 * already-signed bills); CANCELLATION rows each become a Cancellation record.
 * From here the existing collection workflow (Close Day, Reporting, Finance
 * Posting, Audit Trail, Bank Reconciliation) continues completely unchanged.
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

  const systemSalesRow = await prisma.systemSalesRecord.findFirst({ where: { sessionId: id, staffName: staff.name } })

  let cash = 0
  let creditSales = 0
  let discount = 0
  let paymentsReceived = 0
  const channelTotals: Record<string, number> = {}
  const cancellations: typeof usable = []

  for (const t of usable) {
    if (t.category === 'PAYMENT') {
      if ((t.paymentMethod || 'CASH') === 'CASH') cash += t.amount
      else channelTotals[t.paymentMethod!] = roundMoney((channelTotals[t.paymentMethod!] || 0) + t.amount)
    } else if (t.category === 'CREDIT_SALE') creditSales += t.amount
    else if (t.category === 'DISCOUNT') discount += t.amount
    else if (t.category === 'SIGNED_BILL') paymentsReceived += t.amount
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
        creditSales: roundMoney(creditSales),
        discount: roundMoney(discount),
        discountReason: discount > 0 ? 'Staff-declared discount(s), see Transaction Sessions drill-down' : null,
        paymentsReceived: roundMoney(paymentsReceived),
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

    await tx.staffTransaction.updateMany({ where: { id: { in: usable.map((t) => t.id) } }, data: { status: 'APPROVED' } })

    return created
  })

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
