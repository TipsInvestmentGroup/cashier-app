import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, writeOutletId, readOutletScope, CASHIER_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay } from 'date-fns'
import { overlayEnginePrices, type ResolvedLine } from '@/lib/sales-import'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** GET — list import batches (newest first), outlet-scoped. ?status=&outletId= */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') || undefined
  const outletId = readOutletScope(user, searchParams.get('outletId'))

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (outletId) where.outletId = outletId

  const rows = await db.salesImport.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: { outlet: { select: { name: true } }, _count: { select: { lines: true } } },
  })
  return NextResponse.json({ rows })
}

/**
 * POST — create a new import batch from resolved lines (Preview → Approval).
 * Batch is stored as PENDING_APPROVAL; nothing feeds SalesMetric/analytics until
 * it is imported via /[id] PATCH { action:'approve' }.
 * Body: { outletId?, fileName, sourceLabel?, periodFrom?, periodTo?, lines: ResolvedLine[] }
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const outletId = writeOutletId(user, body.outletId)
  if (!outletId) return NextResponse.json({ error: 'Select the outlet for this import.' }, { status: 400 })
  const fileName = String(body.fileName || '').trim() || 'sales-import'
  const lines: ResolvedLine[] = Array.isArray(body.lines) ? body.lines : []
  if (!lines.length) return NextResponse.json({ error: 'No lines to import.' }, { status: 400 })

  // Reject a batch that still has hard-blocking issues so unapproved bad data
  // never reaches the pipeline (the UI enforces this too; this is the backstop).
  const blocking = lines.filter((l) => l.issues?.some((i) => i === 'UNKNOWN_STAFF' || i === 'MISSING_STAFF' || i === 'MISSING_VALUE'))
  if (blocking.length) return NextResponse.json({ error: `${blocking.length} row(s) still have unresolved staff or missing values. Fix them before submitting.` }, { status: 400 })

  const company = await prisma.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })

  // Re-overlay Price-List-Engine prices server-side so expected prices/mismatch
  // flags are authoritative even if the client matched a product after preview.
  const refDate = lines.find((l) => l.date)?.date
  const priced = await overlayEnginePrices(lines, { outletId, date: refDate ? new Date(refDate) : new Date() })

  let totalQty = 0, totalAmount = 0, unmatchedStaff = 0, unmatchedProducts = 0
  const lineData = priced.map((l) => {
    const qty = roundMoney(Number(l.qty) || 0)
    const amount = roundMoney(Number(l.amount) || 0)
    totalQty += qty; totalAmount += amount
    if (!l.staffMatched) unmatchedStaff++
    if (l.rawProductName && !l.productMatched) unmatchedProducts++
    return {
      date: l.date ? startOfDay(new Date(l.date)) : startOfDay(new Date()),
      outletId,
      rawStaffName: String(l.rawStaffName || '').slice(0, 200),
      staffName: String(l.staffName || '').slice(0, 200),
      staffMatched: !!l.staffMatched,
      rawProductName: String(l.rawProductName || '').slice(0, 300),
      productId: l.productId || null,
      productName: String(l.productName || '').slice(0, 300),
      productMatched: !!l.productMatched,
      categoryId: l.categoryId || null,
      categoryName: l.categoryName || null,
      qty,
      amount,
      unitPriceUploaded: l.unitPriceUploaded ?? null,
      unitPriceMaster: l.unitPriceMaster ?? null,
      priceListId: l.priceListId ?? null,
      priceMismatch: !!l.priceMismatch,
      issues: l.issues?.length ? JSON.stringify(l.issues) : null,
    }
  })

  const parseD = (s: unknown) => { const d = s ? new Date(String(s)) : null; return d && !isNaN(d.getTime()) ? startOfDay(d) : null }

  const created = await db.salesImport.create({
    data: {
      companyId: company?.companyId || null,
      outletId,
      fileName: fileName.slice(0, 300),
      sourceLabel: body.sourceLabel ? String(body.sourceLabel).slice(0, 300) : null,
      periodFrom: parseD(body.periodFrom),
      periodTo: parseD(body.periodTo),
      status: 'PENDING_APPROVAL',
      rowCount: lineData.length,
      totalQty: roundMoney(totalQty),
      totalAmount: roundMoney(totalAmount),
      unmatchedStaff,
      unmatchedProducts,
      createdById: user.userId,
      createdByName: user.name || user.email || 'Unknown',
      lines: { create: lineData },
    },
    select: { id: true, status: true, rowCount: true },
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'SalesImport', entityId: created.id, details: `Created sales import "${fileName}" (${lineData.length} lines) — pending approval` },
  })

  return NextResponse.json({ ok: true, import: created })
}
