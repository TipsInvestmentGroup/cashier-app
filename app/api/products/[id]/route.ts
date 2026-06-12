import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const MANAGERS = ['ADMIN', 'ACCOUNTANT', 'MANAGER']
const UNITS = ['unit', 'kg', 'crate 24 bottle', 'crate 25 bottle', 'crate 6 bottle']

/** Edit a product. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MANAGERS.includes(user.role)) return NextResponse.json({ error: 'You are not authorized to edit products' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.code !== undefined && String(body.code).trim()) data.code = String(body.code).trim().toUpperCase()
  if (body.buyingPrice !== undefined) data.buyingPrice = Number(body.buyingPrice) || 0
  if (body.sellingPrice !== undefined) data.sellingPrice = Number(body.sellingPrice) || 0
  if (body.unitMeasure !== undefined) data.unitMeasure = UNITS.includes(body.unitMeasure) ? body.unitMeasure : (body.unitMeasure || 'unit')
  if (body.isActive !== undefined) data.isActive = !!body.isActive

  try {
    const item = await prisma.product.update({ where: { id }, data })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'Product', entityId: id, details: `Edited ${item.name}` } })
    return NextResponse.json(item)
  } catch {
    return NextResponse.json({ error: 'Could not update product (code may be taken)' }, { status: 400 })
  }
}

/** Delete a product. Blocks if it is referenced by cancellations (keep history). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MANAGERS.includes(user.role)) return NextResponse.json({ error: 'You are not authorized to delete products' }, { status: 403 })

  const { id } = await params
  const used = await prisma.cancellation.count({ where: { productId: id } })
  if (used > 0) {
    return NextResponse.json({ error: 'This product is used by cancellation records — disable it instead of deleting.' }, { status: 409 })
  }
  await prisma.product.delete({ where: { id } }).catch(() => null)
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'Product', entityId: id, details: 'Deleted product' } })
  return NextResponse.json({ ok: true })
}
