import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveCurrentApprover } from '@/lib/expense-workflow'
import { listFundingSourceLedger } from '@/lib/expense-ledger'
import { payableAmount } from '@/lib/expense-funds'

const MGMT_ROLES = ['ADMIN', 'MANAGER', 'DIRECTOR', 'ACCOUNTANT']

// Frozen snapshot behind the per-request audit PDF and the unapproved routing
// PDF (spec §3 + §7). Everything the document prints is assembled and
// name-resolved HERE, server-side, so the PDF captures values as they stand at
// generation rather than re-querying live state field by field on the client.
// This endpoint is strictly READ-ONLY — generating either PDF never touches the
// approval workflow (spec §7 hard constraint).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const request = await prisma.expenseRequest.findUnique({
    where: { id },
    include: {
      company: { select: { name: true } },
      requestType: { select: { id: true, name: true, approverRoles: true } },
      category: { select: { id: true, name: true, budgetAccount: { select: { code: true, name: true } } } },
      outlet: { select: { id: true, name: true } },
      items: { orderBy: { createdAt: 'asc' } },
      paymentAllocations: { include: { expensePayment: { include: { fundingSource: { select: { id: true, name: true, sourceType: true } } } } } },
      verifications: { orderBy: { verifiedAt: 'asc' } },
    },
  })
  if (!request) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  // "If you can view the request, you can download it" (spec §3): owner or a
  // management role — the same gate as the detail GET.
  if (request.requestedById !== user.userId && !MGMT_ROLES.includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const approvals = await prisma.workflowApproval.findMany({
    where: { expenseRequestId: id },
    orderBy: { createdAt: 'asc' },
  })

  // Batch-resolve every user id the document names (requester, approvers,
  // payers) to a display name in one query — ids never reach the page.
  const userIds = new Set<string>([request.requestedById])
  approvals.forEach((a) => { if (a.approverId) userIds.add(a.approverId) })
  request.paymentAllocations.forEach((pa) => { if (pa.expensePayment.paidById) userIds.add(pa.expensePayment.paidById) })
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
  const nameOf = (uid: string | null | undefined) => (uid ? users.find((u) => u.id === uid)?.name ?? '—' : '—')

  // Fund balance before/after each payment (spec §C). Pulled from the ledger's
  // running balance for the paying fund; only CASH/OTHER funds accumulate a
  // ledger, so bank/drawer-backed funds degrade to null rather than guess.
  const fundIds = [...new Set(request.paymentAllocations.map((pa) => pa.expensePayment.fundingSourceId).filter(Boolean))] as string[]
  const balanceByPaymentId = new Map<string, { before: number; after: number }>()
  for (const fid of fundIds) {
    try {
      const ledger = await listFundingSourceLedger(fid)
      for (const row of ledger.rows) {
        // A PAYMENT row links back to this request via the merged context. Its
        // running balance is the fund position AFTER the payment; BEFORE adds
        // the (signed, negative) amount back.
        if (row.expenseRequestId === id && row.type === 'PAYMENT') {
          const after = row.runningBalance
          const before = Math.round((after - row.amount) * 100) / 100
          // Key by the amount+time is fragile; instead map by the payment the row
          // settled. The ledger row doesn't expose expensePaymentId, so match the
          // allocation on this fund with the same magnitude.
          const match = request.paymentAllocations.find(
            (pa) => pa.expensePayment.fundingSourceId === fid && Math.abs(pa.expensePayment.amount + row.amount) < 0.01,
          )
          if (match) balanceByPaymentId.set(match.expensePayment.id, { before, after })
        }
      }
    } catch { /* non-ledger fund (bank/drawer) — leave balances null */ }
  }

  const currentApprover = await resolveCurrentApprover(prisma, id).catch(() => null)

  const totalPaid = request.paymentAllocations.reduce((s, pa) => s + pa.amount, 0)
  const approvedAmount = payableAmount(request)

  return NextResponse.json({
    id: request.id,
    reference: request.requestNumber,
    status: request.status,
    direction: request.direction,
    createdAt: request.createdAt,
    company: request.company?.name ?? '',
    outlet: request.outlet?.name ?? null,
    requestedBy: nameOf(request.requestedById),
    transactionType: request.requestType?.name ?? '',
    expenseType: request.expenseType,
    category: request.category?.name ?? '',
    glAccount: request.category?.budgetAccount ? `${request.category.budgetAccount.code} ${request.category.budgetAccount.name}` : null,
    purpose: request.purpose,
    currency: request.currency,
    amount: request.amount,
    approvedAmount,
    totalPaid,
    items: request.items.map((it) => ({ detail: it.detail, unit: it.unit, unitCost: it.unitCost, amount: it.amount })),
    approvals: approvals.map((a) => ({
      approver: a.approverId ? nameOf(a.approverId) : null,
      role: a.approverRole,
      status: a.status,
      comment: a.comment,
      resolvedAt: a.resolvedAt,
    })),
    // The configured approver chain in order — drives the routing PDF's
    // "Approval Needed" rows for steps that haven't happened yet.
    approverChain: parseRoles(request.requestType?.approverRoles),
    currentApprover,
    payments: request.paymentAllocations.map((pa) => ({
      amount: pa.amount,
      method: pa.expensePayment.paymentMethod,
      payeeName: pa.expensePayment.payeeName,
      reference: pa.expensePayment.reference,
      paidAt: pa.expensePayment.paidAt,
      paidBy: nameOf(pa.expensePayment.paidById),
      fund: pa.expensePayment.fundingSource?.name ?? null,
      balance: balanceByPaymentId.get(pa.expensePayment.id) ?? null,
    })),
    verifications: request.verifications.map((v) => ({
      stage: v.stage,
      verifiedBy: nameOf(v.verifiedById),
      verifiedAt: v.verifiedAt,
      note: v.note,
    })),
  })
}

function parseRoles(raw: string | null | undefined): string[] {
  if (!raw) return []
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : [] } catch { return [] }
}
