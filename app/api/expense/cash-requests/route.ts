import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, CASHIER_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { payableAmount, sourceTypesFor } from '@/lib/expense-funds'
import { resolveBusinessDate, resolveEffectiveConfig } from '@/lib/business-calendar'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * GET — the Close-the-Day "Cash Requests" worklist (redesign §4): the Cashier
 * Cash fund items a cashier pays out in cash for ONE outlet on ONE business
 * day, before reconciling. Scope (§4.1, confirmed decisions): the Cashier Cash
 * fund only (sourceType CASHIER_DRAWER), the given outlet, and strictly the
 * given business day.
 *
 * Unlike the per-fund Ready-to-Pay queue (which lists every unpaid request on
 * one funding source regardless of date and needs a fund id), this is keyed by
 * outlet+date the way the wizard closes a day, and aggregates across whatever
 * Cashier Cash funds that outlet has. PAID rows for the day are RETURNED too
 * (not filtered out) so the screen can show "X of Y paid" progress and grey out
 * settled rows rather than making them vanish on pay (§4.1 / §4.3).
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CASHIER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  if (!outletId) return NextResponse.json({ outletId: null, date: null, count: 0, paidCount: 0, totalToPay: 0, rows: [] })

  const parsed = parse(searchParams.get('date') || '', 'yyyy-MM-dd', new Date())
  const day = isValid(parsed) ? parsed : resolveBusinessDate(new Date(), await resolveEffectiveConfig({ outletId }))
  const range = { gte: startOfDay(day), lte: endOfDay(day) }

  // The Cashier Cash fund CLASS = sourceType CASHIER_DRAWER (lib/expense-funds.ts).
  // A drawer is scoped to a single outlet, or company-wide (outletId null) when
  // it follows a cashier rather than a till — include both, then let the
  // per-request outlet filter below do the actual outlet scoping (§4.1's
  // "outlet = current_outlet" is a property of the request, not the fund).
  const funds = await prisma.fundingSource.findMany({
    where: {
      isActive: true,
      sourceType: { in: sourceTypesFor('CASHIER_CASH') as unknown as string[] },
      OR: [{ outletId }, { outletId: null }],
    },
    select: { id: true },
  })
  if (funds.length === 0) return NextResponse.json({ outletId, date: startOfDay(day).toISOString(), count: 0, paidCount: 0, totalToPay: 0, rows: [], noFund: true })
  const fundIds = funds.map((f) => f.id)

  // OUT requests on those funds, for THIS outlet, created within the business
  // day. APPROVED / PARTIALLY_PAID are payable now; PAID is kept for progress.
  const requests = await prisma.expenseRequest.findMany({
    where: {
      fundingSourceId: { in: fundIds },
      outletId,
      direction: 'OUT',
      status: { in: ['APPROVED', 'PARTIALLY_PAID', 'PAID'] },
      createdAt: range,
    },
    include: {
      requestType: { select: { name: true } },
      category: { select: { name: true } },
      paymentAllocations: { select: { amount: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Batch-resolve the loose scalar refs (requester id, department id) once —
  // same approach lib/expense-ledger.ts uses for its request context.
  const userIds = new Set<string>()
  const deptIds = new Set<string>()
  for (const r of requests) { userIds.add(r.requestedById); if (r.departmentId) deptIds.add(r.departmentId) }
  const [users, depts] = await Promise.all([
    userIds.size ? db.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } }) : Promise.resolve([]),
    deptIds.size ? db.department.findMany({ where: { id: { in: [...deptIds] } }, select: { id: true, name: true } }) : Promise.resolve([]),
  ])
  const userName = new Map<string, string>(users.map((u: { id: string; name: string }) => [u.id, u.name]))
  const deptName = new Map<string, string>(depts.map((d: { id: string; name: string }) => [d.id, d.name]))

  const rows = requests.map((r) => {
    const paid = roundMoney(r.paymentAllocations.reduce((s, a) => s + a.amount, 0))
    const approved = payableAmount(r)
    const outstanding = roundMoney(approved - paid)
    return {
      id: r.id,
      fundingSourceId: r.fundingSourceId,
      requestNumber: r.requestNumber,
      requestedByName: userName.get(r.requestedById) ?? null,
      purpose: r.purpose,
      department: r.departmentId ? deptName.get(r.departmentId) ?? null : null,
      requestType: r.requestType.name,
      category: r.category.name,
      amount: approved,
      paid,
      outstanding,
      currency: r.currency,
      status: r.status,
      // A settled row (nothing left to pay) renders greyed with a checkmark.
      isPaid: r.status === 'PAID' || outstanding <= 0,
      createdAt: r.createdAt,
    }
  })

  const unpaidRows = rows.filter((r) => !r.isPaid)
  return NextResponse.json({
    outletId,
    date: startOfDay(day).toISOString(),
    count: rows.length,
    paidCount: rows.length - unpaidRows.length,
    unpaidCount: unpaidRows.length,
    totalToPay: roundMoney(unpaidRows.reduce((s, r) => s + r.outstanding, 0)),
    rows,
  })
}
