import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { closeExpenseRequest } from '@/lib/expense-verification'

// A financial close — mirrors the Accountant/Admin-only gate on other
// finance-closing actions (e.g. FinancialPeriod locking) rather than the
// broader disburser/approver role sets used elsewhere in this framework.
const CLOSER_ROLES = ['ACCOUNTANT', 'ADMIN']

/** POST — VERIFIED → CLOSED. The final, explicit administrative step. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CLOSER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  try {
    const result = await closeExpenseRequest(prisma, id)
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseRequest', entityId: id, details: 'Closed expense request' },
    })
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to close request' }, { status: 400 })
  }
}
