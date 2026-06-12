import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageDepartments } from '@/lib/petty-access'

const DEFAULTS = ['Purchases of', 'Allowance', 'Transport']

/** List functions (any authed user — needed for the cash-request form). Seeds defaults once. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const count = await prisma.pettyFunction.count()
  if (count === 0) {
    for (const name of DEFAULTS) {
      await prisma.pettyFunction.upsert({ where: { name }, update: {}, create: { name } })
    }
  }

  const items = await prisma.pettyFunction.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(items)
}

/** Create a function — owner / fixed managers / owner-chosen manager only. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageDepartments(user.email))) return NextResponse.json({ error: 'You are not authorized to add functions' }, { status: 403 })

  const { name } = await req.json().catch(() => ({}))
  if (!name || !String(name).trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  try {
    const item = await prisma.pettyFunction.create({ data: { name: String(name).trim() } })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'PettyFunction', entityId: item.id, details: `Added function ${item.name}` } })
    return NextResponse.json(item, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A function with that name already exists' }, { status: 409 })
  }
}
