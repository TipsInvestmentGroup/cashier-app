import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance } from '@/lib/finance-access'
import { tenantCompanyId } from '@/lib/tenant'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id },
    include: { supplier: true, grn: { include: { items: true } }, allocations: { include: { payment: true } } },
  })
  const companyId = await tenantCompanyId(user)
  if (!invoice || !companyId || invoice.companyId !== companyId) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  return NextResponse.json(invoice)
}
