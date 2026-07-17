import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManagePersons } from '@/lib/persons-access'

const toCode = (s: string) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** List product categories (any authed user — needed by the Products form and cancellation-reason mapping). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const items = await prisma.productCategory.findMany({ orderBy: { label: 'asc' } })
  return NextResponse.json(items)
}

/** Add a category — owner / fixed manager / owner-chosen manager only. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManagePersons(user.email))) return NextResponse.json({ error: 'You are not authorized to add product categories' }, { status: 403 })

  const { label } = await req.json().catch(() => ({}))
  if (!label || !String(label).trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const code = toCode(label)
  if (!code) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
  try {
    const item = await prisma.productCategory.create({ data: { code, label: String(label).trim() } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'ProductCategory', entityId: item.id, details: `Added category ${item.label} (${item.code})` } })
    return NextResponse.json(item, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A category with that name already exists' }, { status: 409 })
  }
}
