import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/** PATCH — update an expense category's editable fields. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.expenseCategory.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body.legacyFunctionName !== undefined) data.legacyFunctionName = body.legacyFunctionName ? String(body.legacyFunctionName) : null
  if (body.budgetAccountId !== undefined) {
    if (body.budgetAccountId) {
      const account = await prisma.account.findUnique({ where: { id: String(body.budgetAccountId) } })
      if (!account) return NextResponse.json({ error: 'budgetAccountId does not reference a known account' }, { status: 400 })
      data.budgetAccountId = account.id
    } else {
      data.budgetAccountId = null
    }
  }
  if (body.spendingLimit !== undefined) data.spendingLimit = Number(body.spendingLimit) > 0 ? Number(body.spendingLimit) : 0
  if (body.costCenter !== undefined) data.costCenter = body.costCenter ? String(body.costCenter) : null
  if (body.departmentId !== undefined) data.departmentId = body.departmentId ? String(body.departmentId) : null
  if (body.eventId !== undefined) data.eventId = body.eventId ? String(body.eventId) : null
  if (body.isActive !== undefined) data.isActive = body.isActive === true

  const category = await prisma.expenseCategory.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseCategory', entityId: id, details: `Updated expense category ${category.name}` },
  })
  return NextResponse.json(category)
}

/** DELETE — soft-delete (isActive → false); historical requests still reference it. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.expenseCategory.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  await prisma.expenseCategory.update({ where: { id }, data: { isActive: false } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'ExpenseCategory', entityId: id, details: `Deactivated expense category ${existing.name}` },
  })
  return NextResponse.json({ ok: true })
}
