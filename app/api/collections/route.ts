import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
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
    include: { outlet: true, cashier: { select: { name: true } } },
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

  const total = Number(cash) + Number(crdb) + Number(stanbic) + Number(mpesa)
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
      cash: Number(cash),
      crdb: Number(crdb),
      stanbic: Number(stanbic),
      mpesa: Number(mpesa),
      total,
      staffName: staffName || null,
      systemSales: Number(systemSales) || 0,
      notes,
      outletId: usedOutletId,
      cashierId: user.userId,
      date: date ? new Date(date) : new Date(),
    },
    include: { outlet: true },
  })

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: 'CREATE',
      entity: 'DailyCollection',
      entityId: collection.id,
      details: `Total: ${total}`,
    },
  })

  // Auto-create a Staff Loss when the system (POS) sales exceed what was collected.
  // The shortfall becomes an unpaid STAFF_LOSS bill → flows into Receivables and
  // the Payroll Deduction report.
  const shortfall = (Number(systemSales) || 0) - total
  let staffLoss: { amount: number; voucher: string; staffName: string } | null = null
  if (staffName && shortfall > 0) {
    const person = await prisma.person.findFirst({ where: { name: staffName, type: 'STAFF_LOSS' } })
    const voucherNumber = `SL-${collection.id}` // unique (derived from collection id)
    const bill = await prisma.signedBill.create({
      data: {
        voucherNumber,
        billType: 'STAFF_LOSS',
        personId: person?.id ?? null,
        personName: staffName,
        amount: shortfall,
        serviceStaff: staffName,
        description: `Auto staff loss: System sales ${Number(systemSales)} − collected ${total} (daily collection ${collection.id})`,
        status: 'UNPAID',
        date: date ? new Date(date) : new Date(),
        outletId: usedOutletId,
        cashierId: user.userId,
      },
    })
    await prisma.auditLog.create({
      data: {
        userId: user.userId,
        action: 'CREATE',
        entity: 'SignedBill',
        entityId: bill.id,
        details: `Auto staff loss ${shortfall} for ${staffName} from collection ${collection.id}`,
      },
    })
    staffLoss = { amount: shortfall, voucher: voucherNumber, staffName }
  }

  return NextResponse.json({ ...collection, staffLoss }, { status: 201 })
}
