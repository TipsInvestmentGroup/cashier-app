import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { executeTopUpPayment } from '@/lib/expense-workflow'
import { hasGrant } from '@/lib/expense-grants'

/**
 * POST — the Digital Expenses Custodian pays an approved Petty Cash top-up
 * (Custodian Report Spec v2 §2.2). Body: { companyPaymentAccountId } — which
 * digital account to pay from.
 *
 * In ONE transaction lib/expense-workflow.ts executeTopUpPayment posts BOTH
 * money-flow sides linked by this request id: a BankTransaction TRANSFER out of
 * the chosen digital account, and the fund's REPLENISH (crediting the petty cash
 * float), then closes the request and confirms to the original requester.
 *
 * Gated on DIGITAL custodian access for the fund's outlet — the §4 grant, not a
 * job title (ADMIN always allowed). This is deliberately NOT the disburser role
 * list the OUT-pay route uses: paying a top-up out of a digital account is the
 * Digital Custodian's job, whoever holds that grant.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const request = await prisma.expenseRequest.findUnique({
    where: { id },
    select: { id: true, direction: true, status: true, outletId: true, fundingSource: { select: { outletId: true } } },
  })
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  if (request.direction !== 'IN') return NextResponse.json({ error: 'Not a top-up request' }, { status: 400 })

  // Scope the DIGITAL custodian check to the FUND's outlet when it has one, else
  // the request's — mirrors how the approval chain is scoped elsewhere.
  const outletId = request.fundingSource?.outletId ?? request.outletId ?? null
  const canPay = user.role === 'ADMIN' || (await hasGrant(user.userId, 'CUSTODIAN', { fundClass: 'DIGITAL', outletId }))
  if (!canPay) {
    return NextResponse.json({ error: 'You need Digital Expenses Custodian access to pay a top-up. Ask an admin to grant it under Manage Access.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!body.companyPaymentAccountId || !String(body.companyPaymentAccountId).trim()) {
    return NextResponse.json({ error: 'companyPaymentAccountId is required — choose which digital account to pay from' }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction((tx) => executeTopUpPayment(tx, {
      expenseRequestId: id,
      companyPaymentAccountId: String(body.companyPaymentAccountId),
      actorId: user.userId,
      actorName: user.name,
    }))
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseRequest', entityId: id, details: `Paid top-up (${result.allocated}) from digital account ${body.companyPaymentAccountId} → ${result.status}` },
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to pay top-up' }, { status: 400 })
  }
}
