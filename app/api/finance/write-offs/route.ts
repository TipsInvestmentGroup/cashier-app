import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canManageFinance } from '@/lib/finance-access'
import { RESOURCES } from '@/lib/rbac'
import { writeOffSignedBill } from '@/lib/finance-ar'

/** Write off some or all of a SignedBill's remaining balance as bad debt. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await canManageFinance(user.email, user.userId, user.role, RESOURCES.FINANCE_RECEIVABLES))) {
    return NextResponse.json({ error: 'You are not authorized to write off receivables' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { signedBillId, amount, reason } = body
  if (!signedBillId || !(Number(amount) > 0)) return NextResponse.json({ error: 'signedBillId and a positive amount are required' }, { status: 400 })

  try {
    const writeOff = await writeOffSignedBill({ signedBillId, amount: Number(amount), reason: reason || null, createdById: user.userId })
    await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'SignedBillWriteOff', entityId: writeOff.id, details: `Wrote off ${amount} on bill ${signedBillId}${reason ? ` — ${reason}` : ''}` } })
    return NextResponse.json(writeOff, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not write off this bill' }, { status: 400 })
  }
}
