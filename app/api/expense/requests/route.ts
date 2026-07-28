import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/expense-config'
import { createExpenseRequest } from '@/lib/expense-requests'

// Roles that can see every request, not just their own — mirrors the
// CASHIER/WAITER-vs-management split used across the app's other
// role-scoped list endpoints.
const MGMT_ROLES = ['ADMIN', 'MANAGER', 'DIRECTOR', 'ACCOUNTANT']

/** GET — list expense requests. Management roles see everything (optionally
 *  filtered by status); everyone else sees only their own requests. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const status = req.nextUrl.searchParams.get('status') || undefined
  const isMgmt = MGMT_ROLES.includes(user.role)

  const requests = await prisma.expenseRequest.findMany({
    where: { ...(status ? { status } : {}), ...(isMgmt ? {} : { requestedById: user.userId }) },
    orderBy: [{ createdAt: 'desc' }],
    include: {
      requestType: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      items: true,
      fieldValues: true,
      _count: { select: { paymentAllocations: true } },
    },
  })
  return NextResponse.json(requests)
}

/** POST — create a DRAFT expense request. Any authenticated user may create
 *  one for themselves (mirrors PettyCash's open-ish request access — the
 *  approval gate, not the create gate, is where this framework restricts). */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  if (!body.requestTypeId) return NextResponse.json({ error: 'requestTypeId is required' }, { status: 400 })
  if (!body.categoryId) return NextResponse.json({ error: 'categoryId is required' }, { status: 400 })
  if (!body.purpose || !String(body.purpose).trim()) return NextResponse.json({ error: 'Purpose is required' }, { status: 400 })

  const companyId = await resolveCompanyId(prisma, body.outletId || user.outletId || null)
  if (!companyId) return NextResponse.json({ error: 'No company configured' }, { status: 400 })

  try {
    const result = await createExpenseRequest(prisma, {
      companyId,
      requestTypeId: String(body.requestTypeId),
      categoryId: String(body.categoryId),
      requestedById: user.userId,
      amount: body.amount !== undefined ? Number(body.amount) : undefined,
      currency: body.currency ? String(body.currency) : undefined,
      purpose: String(body.purpose),
      outletId: body.outletId ? String(body.outletId) : user.outletId || null,
      departmentId: body.departmentId ? String(body.departmentId) : null,
      eventId: body.eventId ? String(body.eventId) : null,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      items: Array.isArray(body.items) ? body.items.map((it: { detail: string; unit?: number; unitCost?: number; amount: number }) => ({
        detail: String(it.detail), unit: it.unit !== undefined ? Number(it.unit) : undefined,
        unitCost: it.unitCost !== undefined ? Number(it.unitCost) : undefined, amount: Number(it.amount),
      })) : undefined,
      fieldValues: body.fieldValues && typeof body.fieldValues === 'object' ? body.fieldValues : undefined,
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'ExpenseRequest', entityId: result.id, details: `Created expense request: ${body.purpose}` },
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create request' }, { status: 400 })
  }
}
