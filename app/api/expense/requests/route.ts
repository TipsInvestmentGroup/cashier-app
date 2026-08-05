import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/expense-config'
import { createExpenseRequest } from '@/lib/expense-requests'
import { hasGrant, requestGateActive } from '@/lib/expense-grants'

// Roles that can see every request, not just their own — mirrors the
// CASHIER/WAITER-vs-management split used across the app's other
// role-scoped list endpoints.
const MGMT_ROLES = ['ADMIN', 'MANAGER', 'DIRECTOR', 'ACCOUNTANT']

// Who may raise a request in someone else's name (a manager entering a
// reimbursement for a waiter). The requester still has to hold Requesting Access
// themselves — this only controls who can do the data entry.
const ON_BEHALF_ROLES = ['ADMIN', 'MANAGER', 'DIRECTOR', 'ACCOUNTANT']

/** GET — list expense requests. Management roles see everything (optionally
 *  filtered by status); everyone else sees only their own requests. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const status = req.nextUrl.searchParams.get('status') || undefined
  const isMgmt = MGMT_ROLES.includes(user.role)

  // Disbursements only. Fund top-up requests share this table (direction=IN, so
  // §8's approval chain and notifications are reused rather than forked) but are
  // a different thing to a user — they belong on the custodian's ledger screen,
  // not in "my expense requests". Explicit filter rather than relying on there
  // being no IN rows yet.
  const requests = await prisma.expenseRequest.findMany({
    where: { direction: 'OUT', ...(status ? { status } : {}), ...(isMgmt ? {} : { requestedById: user.userId }) },
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

  // §4: the access list decides who may submit an Expense Form. The gate only
  // applies once any REQUEST grant exists (see requestGateActive) — before that,
  // submitting stays open exactly as it was, so this needs no backfill.
  const requestedById = body.requestedById ? String(body.requestedById) : user.userId
  if (requestedById !== user.userId && !ON_BEHALF_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'You cannot raise a request on behalf of someone else' }, { status: 403 })
  }
  if (await requestGateActive(companyId)) {
    if (!(await hasGrant(requestedById, 'REQUEST', { outletId: body.outletId ? String(body.outletId) : user.outletId || null }))) {
      const who = requestedById === user.userId ? 'You do not' : 'That user does not'
      return NextResponse.json({ error: `${who} have Requesting Access for this outlet. Grant it under Setup → Expense Settings → Manage Access.` }, { status: 403 })
    }
  }

  try {
    const result = await createExpenseRequest(prisma, {
      companyId,
      requestTypeId: String(body.requestTypeId),
      categoryId: String(body.categoryId),
      requestedById,
      fundingSourceId: body.fundingSourceId ? String(body.fundingSourceId) : null,
      direction: body.direction === 'IN' ? 'IN' : 'OUT',
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
