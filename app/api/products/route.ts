import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { hasPermission, RESOURCES } from '@/lib/rbac'

const MANAGERS = ['ADMIN', 'ACCOUNTANT', 'MANAGER']
const UNITS = ['unit', 'kg', 'crate 24 bottle', 'crate 25 bottle', 'crate 6 bottle']

/** Build a human-readable, unique product code from the name (e.g. "Coca Cola" → COC-001). */
async function generateCode(name: string): Promise<string> {
  const base = (String(name).replace(/[^a-zA-Z0-9]/g, '').slice(0, 3) || 'PRD').toUpperCase().padEnd(3, 'X')
  let n = (await prisma.product.count({ where: { code: { startsWith: `${base}-` } } })) + 1
  // ensure uniqueness even if codes were deleted/reused
  while (true) {
    const code = `${base}-${String(n).padStart(3, '0')}`
    const exists = await prisma.product.findUnique({ where: { code } })
    if (!exists) return code
    n++
  }
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const items = await prisma.product.findMany({ orderBy: { name: 'asc' }, include: { productCategory: { select: { id: true, label: true } } } })
  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!MANAGERS.includes(user.role) && !(await hasPermission(user.email, user.userId, RESOURCES.PRODUCTS, 'add'))) {
    return NextResponse.json({ error: 'You are not authorized to add products' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { name, buyingPrice, sellingPrice, unitMeasure, code, categoryId } = body
  if (!name || !String(name).trim()) return NextResponse.json({ error: 'Product name is required' }, { status: 400 })
  const unit = UNITS.includes(unitMeasure) ? unitMeasure : (unitMeasure || 'unit')

  const finalCode = (code && String(code).trim()) ? String(code).trim().toUpperCase() : await generateCode(name)
  try {
    const item = await prisma.product.create({
      data: {
        code: finalCode,
        name: String(name).trim(),
        buyingPrice: roundMoney(buyingPrice),
        sellingPrice: roundMoney(sellingPrice),
        unitMeasure: unit,
        categoryId: categoryId || null,
      },
    })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'Product', entityId: item.id, details: `Added product ${item.name} (${item.code})` } })
    return NextResponse.json(item, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A product with that code already exists' }, { status: 409 })
  }
}
