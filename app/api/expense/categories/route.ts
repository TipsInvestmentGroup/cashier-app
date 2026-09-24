import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'

/** GET — list expense categories. Any authenticated user (the New Expense
 *  Request form needs this to render); non-ADMIN only sees active ones. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Archived rows are hidden from EVERY caller (admin included) — they exist
  // only to keep historical requests readable, never to be picked again. ADMIN
  // still sees inactive-but-not-archived rows so they can be managed in Expense
  // Settings; everyone else only sees active ones.
  const categories = await prisma.expenseCategory.findMany({
    where: user.role === 'ADMIN' ? { archived: false } : { isActive: true, archived: false },
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

  // A new category MUST point at a real GL account — no silent fallback to the
  // suspense bucket. For a deliberate cleanup bucket the admin picks the
  // '9000 Unclassified / Suspense Expense' account explicitly, which makes the
  // choice visible rather than a default nobody sees.
  if (!body.budgetAccountId) return NextResponse.json({ error: 'Pick a GL account for this category (choose "9000 Unclassified / Suspense" only for a deliberate uncategorized bucket)' }, { status: 400 })
  const account = await prisma.account.findUnique({ where: { id: String(body.budgetAccountId) } })
  if (!account) return NextResponse.json({ error: 'budgetAccountId does not reference a known account' }, { status: 400 })
  const budgetAccountId: string = account.id

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
