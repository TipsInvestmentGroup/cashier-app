import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, CASHIER_ROLES } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

const CASH_LIKE_SOURCE_TYPES = ['CASH', 'CASHIER_DRAWER']

/**
 * Expense & Disbursement Framework report — mirrors the shape of
 * app/api/petty-cash/report/route.ts (totals + groupings) but reads
 * ExpenseRequest/ExpensePayment instead of PettyCash, so an outlet mid-way
 * through the request-type-by-request-type migration has one report shape
 * to look at, not two unrelated ones. Pass ?combined=true to also fold in
 * the legacy PettyCash figures for the same window, producing one
 * "everything petty-cash-shaped" total instead of two numbers to reconcile
 * by hand during the side-by-side rollout.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CASHIER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const combined = searchParams.get('combined') === 'true'
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const to = parseD(searchParams.get('to')) || new Date()
  const from = parseD(searchParams.get('from')) || to
  const dateRange = { gte: startOfDay(from), lte: endOfDay(to) }

  const requestWhere: Record<string, unknown> = { createdAt: dateRange }
  if (outletId) requestWhere.outletId = outletId

  const paymentWhere: Record<string, unknown> = { paidAt: dateRange }
  if (outletId) paymentWhere.fundingSource = { outletId }

  const [requests, payments, outlets, departments, users] = await Promise.all([
    prisma.expenseRequest.findMany({
      where: requestWhere,
      include: { category: { select: { name: true } }, requestType: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.expensePayment.findMany({
      where: paymentWhere,
      include: {
        fundingSource: { select: { name: true, sourceType: true, outletId: true } },
        allocations: {
          include: {
            expenseRequest: {
              select: {
                id: true, outletId: true, departmentId: true, requestedById: true,
                category: { select: { name: true } },
                requestType: { select: { name: true } },
              },
            },
          },
        },
      },
      orderBy: { paidAt: 'desc' },
    }),
    prisma.outlet.findMany({ select: { id: true, name: true } }),
    prisma.department.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ])

  const outletName = (id: string | null | undefined) => outlets.find((o) => o.id === id)?.name || 'Unassigned'
  const departmentName = (id: string | null | undefined) => departments.find((d) => d.id === id)?.name || 'Unassigned'
  const userName = (id: string | null | undefined) => users.find((u) => u.id === id)?.name || id || '—'

  const groupBy = <T,>(rows: T[], key: (row: T) => string, amount: (row: T) => number) => {
    const m: Record<string, { label: string; count: number; amount: number }> = {}
    for (const row of rows) {
      const label = key(row) || '—'
      ;(m[label] ||= { label, count: 0, amount: 0 })
      m[label].count += 1
      m[label].amount = roundMoney(m[label].amount + amount(row))
    }
    return Object.values(m).sort((a, b) => b.amount - a.amount)
  }

  // One row per (payment, allocation) — needed since a single payment can be
  // split across several requests/categories/departments (mixed/partial pay).
  const allocationRows = payments.flatMap((p) =>
    p.allocations.map((a) => ({
      amount: a.amount,
      outletId: a.expenseRequest.outletId,
      departmentId: a.expenseRequest.departmentId,
      requestedById: a.expenseRequest.requestedById,
      categoryName: a.expenseRequest.category.name,
      requestTypeName: a.expenseRequest.requestType.name,
      fundingSourceName: p.fundingSource.name,
      sourceType: p.fundingSource.sourceType,
    }))
  )

  const cashLike = payments.filter((p) => CASH_LIKE_SOURCE_TYPES.includes(p.fundingSource.sourceType))
  const fundBacked = payments.filter((p) => !CASH_LIKE_SOURCE_TYPES.includes(p.fundingSource.sourceType))
  const sumPayments = (rows: typeof payments) => roundMoney(rows.reduce((s, p) => s + p.amount, 0))

  const paidTotal = sumPayments(payments)
  const requestedTotal = roundMoney(requests.reduce((s, r) => s + r.amount, 0))
  const pendingTotal = roundMoney(requests.filter((r) => r.status === 'PENDING_APPROVAL').reduce((s, r) => s + r.amount, 0))
  const approvedUnpaidTotal = roundMoney(requests.filter((r) => r.status === 'APPROVED').reduce((s, r) => s + r.amount, 0))

  const result: Record<string, unknown> = {
    from, to,
    totals: {
      requested: requestedTotal,
      paid: paidTotal,
      pending: pendingTotal,
      approvedUnpaid: approvedUnpaidTotal,
      cashierPaid: sumPayments(cashLike),
      fundBackedPaid: sumPayments(fundBacked),
    },
    byOutlet: groupBy(allocationRows, (r) => outletName(r.outletId), (r) => r.amount),
    byCategory: groupBy(allocationRows, (r) => r.categoryName, (r) => r.amount),
    byDepartment: groupBy(allocationRows, (r) => departmentName(r.departmentId), (r) => r.amount),
    byRequester: groupBy(allocationRows, (r) => userName(r.requestedById), (r) => r.amount),
    byFundingSource: groupBy(payments, (p) => p.fundingSource.name, (p) => p.amount),
    byRequestType: groupBy(allocationRows, (r) => r.requestTypeName, (r) => r.amount),
  }

  if (combined) {
    const legacyWhere: Record<string, unknown> = { date: dateRange }
    if (outletId) legacyWhere.outletId = outletId
    const legacyPaid = await prisma.pettyCash.findMany({ where: { ...legacyWhere, paymentStatus: 'PAID' }, select: { amount: true } })
    const legacyPaidTotal = roundMoney(legacyPaid.reduce((s, p) => s + p.amount, 0))
    result.legacy = { paid: legacyPaidTotal }
    result.combinedPaidTotal = roundMoney(legacyPaidTotal + paidTotal)
  }

  return NextResponse.json(result)
}
