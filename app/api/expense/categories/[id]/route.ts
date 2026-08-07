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

  // Reactivation guard: a category is worthless if the GL account it books to
  // has itself been deactivated, so block the flip and name the culprit rather
  // than quietly re-enabling a broken row. Only checked on an inactive→active
  // transition (editing an already-active row never needs it).
  if (body.isActive === true && !existing.isActive) {
    const accountId = data.budgetAccountId !== undefined ? (data.budgetAccountId as string | null) : existing.budgetAccountId
    if (accountId) {
      const account = await prisma.account.findUnique({ where: { id: accountId } })
      if (account && !account.isActive) {
        return NextResponse.json({ error: `Can't activate — linked GL account '${account.name}' is inactive.` }, { status: 409 })
      }
    }
  }

  const category = await prisma.expenseCategory.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseCategory', entityId: id, details: `Updated expense category ${category.name}` },
  })
  return NextResponse.json(category)
}

/**
 * DELETE — three modes via ?mode=:
 *   (none)    soft-delete / Deactivate (isActive → false) — reversible.
 *   archive   permanently retire but keep the row (archived → true) so linked
 *             requests stay readable; hidden from every live list.
 *   hard      permanently remove the row from the database. Refused (409) if any
 *             request still references it — the FK is Restrict and, more to the
 *             point, that history must be preserved (archive instead).
 * The server re-derives the linked-request count itself; it never trusts the
 * client's decision about which mode is allowed.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.expenseCategory.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  const mode = req.nextUrl.searchParams.get('mode')

  if (mode === 'hard') {
    const requests = await prisma.expenseRequest.count({ where: { categoryId: id } })
    if (requests > 0) {
      return NextResponse.json({ error: `${existing.name} has ${requests} linked request(s) and can't be permanently deleted. Archive it instead.` }, { status: 409 })
    }
    await prisma.expenseCategory.delete({ where: { id } })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'DELETE', entity: 'ExpenseCategory', entityId: id, details: `Permanently deleted expense category ${existing.name}` },
    })
    return NextResponse.json({ ok: true, action: 'deleted' })
  }

  if (mode === 'archive') {
    await prisma.expenseCategory.update({ where: { id }, data: { archived: true, isActive: false } })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseCategory', entityId: id, details: `Archived expense category ${existing.name}` },
    })
    return NextResponse.json({ ok: true, action: 'archived' })
  }

  await prisma.expenseCategory.update({ where: { id }, data: { isActive: false } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'ExpenseCategory', entityId: id, details: `Deactivated expense category ${existing.name}` },
  })
  return NextResponse.json({ ok: true, action: 'deactivated' })
}
