import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance, canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { createSupplierInvoice } from '@/lib/finance'

/** List supplier invoices — includes enough to render an AP aging view
 *  client-side (outstanding = total - amountPaid, days overdue from dueDate). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  const status = searchParams.get('status')
  if (!companyId) return NextResponse.json([])

  const invoices = await prisma.supplierInvoice.findMany({
    where: { companyId, ...(status ? { status } : {}) },
    include: { supplier: true, grn: true, allocations: true },
    orderBy: { invoiceDate: 'desc' },
    take: 200,
  })
  return NextResponse.json(invoices)
}

/** Formalize a supplier invoice against a received GRN. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_PAYABLES))) {
    return NextResponse.json({ error: 'You are not authorized to raise supplier invoices' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { grnId, supplierId, supplierInvoiceRef, invoiceDate, dueDate, subtotal, vatAmount, total } = body
  if (!grnId || !supplierId || !invoiceDate || !(Number(total) > 0)) {
    return NextResponse.json({ error: 'grnId, supplierId, invoiceDate and a positive total are required' }, { status: 400 })
  }
  const companyId = body.companyId || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })

  try {
    const invoice = await createSupplierInvoice({
      grnId, supplierId, companyId, supplierInvoiceRef: supplierInvoiceRef || null,
      invoiceDate: new Date(invoiceDate), dueDate: dueDate ? new Date(dueDate) : null,
      subtotal: Number(subtotal) || 0, vatAmount: Number(vatAmount) || 0, total: Number(total),
      createdById: user.userId,
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'SupplierInvoice', entityId: invoice.id, details: `Invoice ${invoice.invoiceNumber} for GRN ${grnId}` } })
    return NextResponse.json(invoice, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not create the supplier invoice' }, { status: 400 })
  }
}
