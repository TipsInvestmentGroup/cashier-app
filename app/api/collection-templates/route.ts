import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'

const toCode = (s: string) => String(s).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')

/** List templates (any authed user — needed to resolve an outlet's default template). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const items = await prisma.collectionTemplate.findMany({
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, code: true, name: true, description: true, isDefault: true, isActive: true, createdAt: true },
  })
  return NextResponse.json(items)
}

/** Create a new (empty) template — ADMIN only. Stages/sections/fields are added via the editor (PUT on the detail route). */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && !(await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_TEMPLATES, 'add'))) {
    return NextResponse.json({ error: 'You are not authorized to create collection templates' }, { status: 403 })
  }

  const { name, description } = await req.json().catch(() => ({}))
  if (!name || !String(name).trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const code = toCode(name)
  if (!code) return NextResponse.json({ error: 'Invalid name' }, { status: 400 })

  const company = await prisma.company.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!company) return NextResponse.json({ error: 'No company record found — run the database seed first' }, { status: 500 })

  try {
    const template = await prisma.collectionTemplate.create({
      data: { companyId: company.id, code, name: String(name).trim(), description: description ? String(description).trim() : null },
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'CollectionTemplate', entityId: template.id, details: `Created template ${template.name} (${template.code})` },
    })
    return NextResponse.json(template, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'A template with that name already exists' }, { status: 409 })
  }
}
