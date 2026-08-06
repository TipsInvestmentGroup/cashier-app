import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/expense-config'
import { createExpensePayment } from '@/lib/expense-payments'
import { roundMoney } from '@/lib/utils'

// Mirrors lib/petty-access.ts canDisbursePetty()'s role list.
const DISBURSER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN']

/**
 * POST — disburse against this one request. Body: { fundingSourceId,
 * paymentMethod, amount? (defaults to the full outstanding balance),
 * payeeName?, payeeAccount?, reference? }. For a payment split across
 * multiple requests or multiple funding sources, call
 * lib/expense-payments.ts createExpensePayment directly from a future
 * multi-request pay screen — this route is the common single-request case.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!DISBURSER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const request = await prisma.expenseRequest.findUnique({ where: { id }, include: { paymentAllocations: true } })
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.fundingSourceId) return NextResponse.json({ error: 'fundingSourceId is required' }, { status: 400 })
  if (!body.paymentMethod || !String(body.paymentMethod).trim()) return NextResponse.json({ error: 'paymentMethod is required' }, { status: 400 })

  const alreadyPaid = roundMoney(request.paymentAllocations.reduce((s, a) => s + a.amount, 0))
  const outstanding = roundMoney(request.amount - alreadyPaid)
  const amount = body.amount !== undefined ? roundMoney(Number(body.amount)) : outstanding
  if (amount <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 })
  if (amount > outstanding + 0.001) return NextResponse.json({ error: `Amount ${amount} exceeds outstanding balance (${outstanding})` }, { status: 400 })

  const companyId = await resolveCompanyId(prisma, request.outletId)
  if (!companyId) return NextResponse.json({ error: 'No company configured' }, { status: 400 })

  try {
    const result = await createExpensePayment({
      companyId,
      fundingSourceId: String(body.fundingSourceId),
      paymentMethod: String(body.paymentMethod),
      payeeName: body.payeeName ? String(body.payeeName) : null,
      payeeAccount: body.payeeAccount ? String(body.payeeAccount) : null,
      reference: body.reference ? String(body.reference) : null,
      paidAt: body.paidAt ? new Date(body.paidAt) : undefined,
      paidById: user.userId,
      paidByName: user.name,
      outletId: request.outletId,
      allocations: [{ expenseRequestId: id, amount }],
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'ExpensePayment', entityId: result.id, details: `Paid ${amount} on expense request ${id} via ${body.paymentMethod}` },
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to record payment' }, { status: 400 })
  }
}
