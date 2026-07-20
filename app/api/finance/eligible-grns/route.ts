import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance } from '@/lib/finance-access'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'

/** GRNs that don't have a Supplier Invoice raised against them yet — the
 *  picklist for "Raise Supplier Invoice". One GRN -> one invoice in Phase 1. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json([])

  const grns = await prisma.grn.findMany({
    where: { companyId, supplierInvoices: { none: {} } },
    include: {
      items: true,
      purchaseOrder: { select: { supplierId: true, supplier: { select: { id: true, name: true } } } },
    },
    orderBy: { receivedDate: 'desc' },
    take: 100,
  })

  return NextResponse.json(grns.map((g) => ({
    id: g.id, grnNumber: g.grnNumber, supplierName: g.supplierName, receivedDate: g.receivedDate,
    needsCosting: g.needsCosting, itemCount: g.items.length,
    estimatedTotal: g.items.reduce((sum, i) => sum + (i.unitCost || 0) * i.quantityOrdered, 0),
    supplierId: g.purchaseOrder?.supplierId || null, supplierNameFromPO: g.purchaseOrder?.supplier?.name || null,
  })))
}
