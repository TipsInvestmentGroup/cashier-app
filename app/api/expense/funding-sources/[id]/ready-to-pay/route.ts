import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'

const VIEWER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/**
 * GET — the custodian's "Ready to Pay" queue for one fund (§7): every
 * fully-approved-or-partially-paid, unsettled OUT request payable from this
 * fund. The queue is the reliable source of what to pay; the notification is
 * only the nudge, so this is deliberately its own endpoint rather than being
 * inferred from a stream of notifications.
 *
 * Scope: only requests that NAME this fund (fundingSourceId). A fund-agnostic
 * request — one created before §3, or via the API with no fund — is deliberately
 * NOT listed here: it has no single fund it belongs to, so surfacing it would
 * make the same request appear in all three funds' queues at once and be
 * counted three times in totalOutstanding. Those remain payable directly from
 * the request detail page; the queue is a per-fund convenience, not the only
 * pay path. Top-ups (direction=IN) are excluded too — they are settled by
 * allocation, not a payment out.
 *
 * Each row carries its outstanding balance (amount − already-allocated), so the
 * queue shows what is left to pay on partially-paid requests rather than the
 * original amount.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!VIEWER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const source = await prisma.fundingSource.findUnique({ where: { id }, select: { id: true } })
  if (!source) return NextResponse.json({ error: 'Funding source not found' }, { status: 404 })

  const payable = await prisma.expenseRequest.findMany({
    where: { fundingSourceId: id, direction: 'OUT', status: { in: ['APPROVED', 'PARTIALLY_PAID'] } },
    include: {
      requestType: { select: { name: true } }, category: { select: { name: true } },
      paymentAllocations: { select: { amount: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  const rows = payable
    .map((r) => {
      const paid = roundMoney(r.paymentAllocations.reduce((s, a) => s + a.amount, 0))
      return {
        id: r.id,
        purpose: r.purpose,
        amount: r.amount,
        paid,
        outstanding: roundMoney(r.amount - paid),
        currency: r.currency,
        status: r.status,
        requestedById: r.requestedById,
        outletId: r.outletId,
        createdAt: r.createdAt,
        requestType: r.requestType.name,
        category: r.category.name,
      }
    })
    // A rounding artefact could leave a fully-paid request at status
    // PARTIALLY_PAID for a beat; never show a non-positive outstanding.
    .filter((r) => r.outstanding > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  return NextResponse.json({
    fundingSourceId: id,
    count: rows.length,
    totalOutstanding: roundMoney(rows.reduce((s, r) => s + r.outstanding, 0)),
    rows,
  })
}
