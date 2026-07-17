import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'

const DEFAULTS = [
  { code: 'DOUBLE_PUNCH', label: 'Double Punch' },
  { code: 'OUT_OF_STOCK', label: 'Out of Stock' },
  { code: 'WRONG_PUNCH', label: 'Wrong Punch' },
]

const toCode = (s: string) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** List cancellation reasons (any authed user — needed by the picker). Seeds defaults once. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((await prisma.cancellationReason.count()) === 0) {
    for (const d of DEFAULTS) await prisma.cancellationReason.upsert({ where: { code: d.code }, update: {}, create: d })
  }
  const items = await prisma.cancellationReason.findMany({
    orderBy: { createdAt: 'asc' },
    include: { categories: { select: { categoryId: true } }, products: { select: { productId: true } } },
  })
  const shaped = items.map((r) => ({
    ...r,
    categoryIds: r.categories.map((c) => c.categoryId),
    productIds: r.products.map((p) => p.productId),
    categories: undefined,
    products: undefined,
  }))
  return NextResponse.json(shaped)
}

/** Add a reason — owner / fixed manager / owner-chosen manager only. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'You are not authorized to add cancellation reasons' }, { status: 403 })

  const { label } = await req.json().catch(() => ({}))
  if (!label || !String(label).trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const code = toCode(label)
  if (!code) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
  try {
    const item = await prisma.cancellationReason.create({ data: { code, label: String(label).trim() } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'CancellationReason', entityId: item.id, details: `Added reason ${item.label} (${item.code})` } })
    return NextResponse.json(item, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A reason with that name already exists' }, { status: 409 })
  }
}
