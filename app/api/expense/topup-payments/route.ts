import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { fundClassOf, payableAmount } from '@/lib/expense-funds'

/**
 * GET — the Digital Expenses Custodian's "awaiting payment" queue (Custodian
 * Report Spec v2 §2.2). Every fully-approved Petty Cash top-up (direction=IN,
 * status=APPROVED) that is waiting for a digital custodian to pay it out of a
 * digital account, cross-fund. The direction=IN sibling of a fund's Ready-to-Pay
 * queue: the reliable list of what to pay, so the notification is only a nudge.
 *
 * Scoped to what the viewer can actually action — the rows whose fund outlet the
 * viewer holds DIGITAL custodian access for (business-wide grant = every outlet).
 * ADMIN sees them all. A non-custodian simply gets an empty queue, matching the
 * "every row shown is one the viewer can complete" convention of pending-top-ups.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const approved = await prisma.expenseRequest.findMany({
    where: { direction: 'IN', status: 'APPROVED' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, purpose: true, amount: true, allocatedAmount: true, reference: true,
      currency: true, requestedById: true, createdAt: true, outletId: true,
      fundingSource: { select: { id: true, name: true, sourceType: true, outletId: true } },
    },
  })

  // Only Petty Cash top-ups take the digital-custodian route.
  const pettyTopUps = approved.filter((r) => r.fundingSource && fundClassOf(r.fundingSource.sourceType) === 'PETTY_CASH')

  const isAdmin = user.role === 'ADMIN'
  let visible = pettyTopUps
  if (!isAdmin) {
    // Resolve the viewer's DIGITAL custodian reach once: a grant with outletId
    // null is business-wide (every outlet), otherwise it names one outlet — the
    // same null-as-wildcard rule scopeWhere applies.
    const grants = await prisma.expenseAccessGrant.findMany({
      where: { userId: user.userId, grantType: 'CUSTODIAN', fundClass: 'DIGITAL', revokedAt: null },
      select: { outletId: true },
    })
    const businessWide = grants.some((g) => g.outletId === null)
    const allowedOutlets = new Set(grants.map((g) => g.outletId).filter((o): o is string => !!o))
    visible = businessWide
      ? pettyTopUps
      : pettyTopUps.filter((r) => {
          const outletId = r.fundingSource?.outletId ?? r.outletId ?? null
          // A business-wide fund (no outlet) is payable only by a business-wide
          // grant, already handled above; here require an outlet the viewer holds.
          return outletId ? allowedOutlets.has(outletId) : false
        })
  }

  const rows = visible.map((r) => ({
    id: r.id,
    purpose: r.purpose,
    amount: payableAmount(r),
    currency: r.currency,
    reference: r.reference,
    requestedById: r.requestedById,
    createdAt: r.createdAt,
    fundingSourceId: r.fundingSource?.id ?? null,
    fundName: r.fundingSource?.name ?? null,
  }))

  return NextResponse.json({
    count: rows.length,
    totalPending: roundMoney(rows.reduce((s, r) => s + r.amount, 0)),
    rows,
  })
}
