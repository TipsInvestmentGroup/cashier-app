import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'

const ALLOWED = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR']

/** Read-only "Signed Bills" Reconciliation section (§10) — tracking only, no
 *  Pay action, since these are settled by the customer directly, not paid
 *  out by the cashier. Reuses the existing SignedBill model; excludes
 *  STAFF_LOSS (that's a staff debt, tracked via Payroll Deduction, not a
 *  customer signed bill). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const bills = await prisma.signedBill.findMany({
    where: {
      billType: { not: 'STAFF_LOSS' },
      ...(outletId ? { outletId } : {}),
      ...(startDate && endDate ? { date: { gte: new Date(startDate), lte: new Date(endDate) } } : {}),
    },
    orderBy: { date: 'desc' },
    take: 300,
  })

  return NextResponse.json(bills.map((b) => ({
    id: b.id,
    date: b.date.toISOString(),
    customer: b.personName,
    billNumber: b.displayReference || b.voucherNumber || b.autoKey || '—',
    amount: b.amount,
    serviceStaff: b.serviceStaff || '—',
    approvedBy: b.approvedBy || '—',
    status: b.status,
    clearedDate: b.status === 'PAID' ? b.updatedAt.toISOString() : null,
  })))
}
