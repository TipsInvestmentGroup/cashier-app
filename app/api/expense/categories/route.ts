import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'

/** GET — list expense categories (ADMIN-only; Expense Settings). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const categories = await prisma.expenseCategory.findMany({
    orderBy: [{ name: 'asc' }],
    include: { budgetAccount: { select: { id: true, code: true, name: true } }, _count: { select: { requests: true } } },
  })
  return NextResponse.json(categories)
}

/** POST — create an expense category. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const code = String(body.code || name).trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_')
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const companyId = await resolveDefaultCompanyId(prisma)
  if (!companyId) return NextResponse.json({ error: 'No company configured' }, { status: 400 })

  const dupe = await prisma.expenseCategory.findUnique({ where: { companyId_code: { companyId, code } } })
  if (dupe) return NextResponse.json({ error: `A category with code ${code} already exists` }, { status: 409 })

  let budgetAccountId: string | null = null
  if (body.budgetAccountId) {
    const account = await prisma.account.findUnique({ where: { id: String(body.budgetAccountId) } })
    if (!account) return NextResponse.json({ error: 'budgetAccountId does not reference a known account' }, { status: 400 })
    budgetAccountId = account.id
  }

  const category = await prisma.expenseCategory.create({
    data: {
      companyId,
      code,
      name,
      legacyFunctionName: body.legacyFunctionName ? String(body.legacyFunctionName) : null,
      budgetAccountId,
      spendingLimit: Number(body.spendingLimit) > 0 ? Number(body.spendingLimit) : 0,
      costCenter: body.costCenter ? String(body.costCenter) : null,
      departmentId: body.departmentId ? String(body.departmentId) : null,
      eventId: body.eventId ? String(body.eventId) : null,
      isActive: true,
    },
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'ExpenseCategory', entityId: category.id, details: `Created expense category ${name} (${code})` },
  })
  return NextResponse.json(category, { status: 201 })
}
