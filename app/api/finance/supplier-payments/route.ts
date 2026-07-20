import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance, canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { createSupplierPayment } from '@/lib/finance'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  const supplierId = searchParams.get('supplierId')
  if (!companyId) return NextResponse.json([])

  const payments = await prisma.supplierPayment.findMany({
    where: { companyId, ...(supplierId ? { supplierId } : {}) },
    include: { supplier: true, paymentChannel: true, allocations: { include: { supplierInvoice: true } } },
    orderBy: { paymentDate: 'desc' },
    take: 200,
  })
  return NextResponse.json(payments)
}

/** Pay one or more open supplier invoices — partial or full, single or split
 *  across invoices. body: { supplierId, paymentChannelId, amount, paymentDate,
 *  reference?, note?, allocations: [{ supplierInvoiceId, amount }] } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_PAYABLES))) {
    return NextResponse.json({ error: 'You are not authorized to record supplier payments' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { supplierId, paymentChannelId, amount, paymentDate, reference, note, allocations } = body
  if (!supplierId || !paymentChannelId || !(Number(amount) > 0) || !paymentDate) {
    return NextResponse.json({ error: 'supplierId, paymentChannelId, a positive amount and paymentDate are required' }, { status: 400 })
  }
  if (!Array.isArray(allocations) || !allocations.length) {
    return NextResponse.json({ error: 'At least one invoice allocation is required' }, { status: 400 })
  }
  const companyId = body.companyId || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })

  try {
    const payment = await createSupplierPayment({
      companyId, supplierId, paymentChannelId, amount: Number(amount), paymentDate: new Date(paymentDate),
      reference: reference || null, note: note || null, createdById: user.userId,
      allocations: allocations.map((a: { supplierInvoiceId: string; amount: number }) => ({ supplierInvoiceId: a.supplierInvoiceId, amount: Number(a.amount) })),
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'SupplierPayment', entityId: payment.id, details: `Payment ${payment.paymentNumber} of ${amount} to supplier ${supplierId}` } })
    return NextResponse.json(payment, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not record the supplier payment' }, { status: 400 })
  }
}
