import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole, CASHIER_ROLES, MGMT_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { commitImport } from '@/lib/sales-import'
import { resolvePrice } from '@/lib/pricing'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

/** GET — one import batch with its item-level lines. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const imp = await db.salesImport.findUnique({
    where: { id },
    include: { outlet: { select: { name: true } }, lines: { orderBy: [{ staffName: 'asc' }, { productName: 'asc' }] } },
  })
  if (!imp) return NextResponse.json({ error: 'Import not found' }, { status: 404 })
  return NextResponse.json({ import: imp })
}

/**
 * PATCH — act on a batch. Body: { action: 'approve' | 'reject' | 'remap', ... }.
 *  • approve — commit to SalesMetric + remember mappings (MGMT roles).
 *  • reject  — mark REJECTED with a reason (MGMT roles).
 *  • remap   — fix one line's staff/product mapping while PENDING (creator or MGMT).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')

  const imp = await db.salesImport.findUnique({ where: { id }, select: { id: true, status: true, createdById: true } })
  if (!imp) return NextResponse.json({ error: 'Import not found' }, { status: 404 })

  if (action === 'approve') {
    if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can approve an import.' }, { status: 403 })
    if (imp.status !== 'PENDING_APPROVAL' && imp.status !== 'APPROVED') return NextResponse.json({ error: `Cannot approve an import that is ${imp.status}.` }, { status: 409 })
    const result = await commitImport(id, { userId: user.userId, userName: user.name || user.email || 'Unknown' })
    if ('blocked' in result) {
      return NextResponse.json({ error: `Cannot import — these days are locked: ${result.lockedDays.join(', ')}. An Admin must unlock them first.`, lockedDays: result.lockedDays }, { status: 423 })
    }
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  if (action === 'reject') {
    if (!requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only management can reject an import.' }, { status: 403 })
    if (imp.status === 'IMPORTED') return NextResponse.json({ error: 'An imported batch cannot be rejected.' }, { status: 409 })
    await db.salesImport.update({ where: { id }, data: { status: 'REJECTED', rejectedReason: String(body.reason || '').slice(0, 500) || 'No reason given', approvedById: user.userId, approvedByName: user.name || user.email || 'Unknown', approvedAt: new Date() } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'REJECT', entity: 'SalesImport', entityId: id, details: `Rejected sales import: ${String(body.reason || '').slice(0, 200)}` } })
    return NextResponse.json({ ok: true })
  }

  if (action === 'remap') {
    if (user.userId !== imp.createdById && !requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only the uploader or management can edit this import.' }, { status: 403 })
    if (imp.status !== 'PENDING_APPROVAL') return NextResponse.json({ error: `Cannot edit an import that is ${imp.status}.` }, { status: 409 })
    const lineId = String(body.lineId || '')
    const line = await db.salesImportLine.findFirst({ where: { id: lineId, importId: id } })
    if (!line) return NextResponse.json({ error: 'Line not found' }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (typeof body.staffName === 'string' && body.staffName.trim()) { data.staffName = body.staffName.trim().slice(0, 200); data.staffMatched = true }
    if (typeof body.productId === 'string' && body.productId) {
      const p = await prisma.product.findUnique({ where: { id: body.productId }, select: { id: true, name: true, categoryId: true, category: true, productCategory: { select: { label: true } } } })
      if (!p) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
      data.productId = p.id; data.productName = p.name; data.productMatched = true
      data.categoryId = p.categoryId; data.categoryName = p.productCategory?.label || p.category || null
      // Expected price from the Price List Engine (outlet + line date aware).
      const resolved = await resolvePrice(p.id, { outletId: line.outletId, date: line.date })
      const expected = resolved?.price ?? 0
      data.unitPriceMaster = expected
      data.priceListId = resolved?.priceListId ?? null
      const qty = Number(line.qty) || 0
      const up = qty > 0 ? roundMoney((Number(line.amount) || 0) / qty) : null
      data.priceMismatch = !!(up && expected > 0 && Math.abs(up - expected) / expected > 0.01)
    }
    // Recompute the line's issue flags after the fix.
    const merged = { ...line, ...data }
    const issues: string[] = []
    if (!merged.staffMatched) issues.push('UNKNOWN_STAFF')
    if (merged.rawProductName && !merged.productMatched) issues.push('UNKNOWN_PRODUCT')
    if (merged.priceMismatch) issues.push('PRICE_MISMATCH')
    if ((Number(merged.qty) || 0) <= 0 && (Number(merged.amount) || 0) <= 0) issues.push('MISSING_VALUE')
    data.issues = issues.length ? JSON.stringify(issues) : null

    await db.salesImportLine.update({ where: { id: lineId }, data })
    await recountImport(id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

/** DELETE — discard a batch (creator or MGMT). Imported batches cannot be discarded. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, CASHIER_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const imp = await db.salesImport.findUnique({ where: { id }, select: { status: true, createdById: true } })
  if (!imp) return NextResponse.json({ error: 'Import not found' }, { status: 404 })
  if (imp.status === 'IMPORTED') return NextResponse.json({ error: 'An imported batch cannot be discarded (it has updated the system). Reverse it from the Uploads view instead.' }, { status: 409 })
  if (user.userId !== imp.createdById && !requireRole(user, MGMT_ROLES)) return NextResponse.json({ error: 'Only the uploader or management can discard this import.' }, { status: 403 })

  await db.salesImport.delete({ where: { id } }) // cascade removes lines
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'SalesImport', entityId: id, details: 'Discarded sales import' } })
  return NextResponse.json({ ok: true })
}

/** Recompute a batch's roll-up counters after a line edit. */
async function recountImport(id: string) {
  const lines = await db.salesImportLine.findMany({ where: { importId: id }, select: { qty: true, amount: true, staffMatched: true, productMatched: true, rawProductName: true } })
  let totalQty = 0, totalAmount = 0, unmatchedStaff = 0, unmatchedProducts = 0
  for (const l of lines as { qty: number; amount: number; staffMatched: boolean; productMatched: boolean; rawProductName: string }[]) {
    totalQty += l.qty || 0; totalAmount += l.amount || 0
    if (!l.staffMatched) unmatchedStaff++
    if (l.rawProductName && !l.productMatched) unmatchedProducts++
  }
  await db.salesImport.update({ where: { id }, data: { rowCount: lines.length, totalQty: roundMoney(totalQty), totalAmount: roundMoney(totalAmount), unmatchedStaff, unmatchedProducts } })
}
