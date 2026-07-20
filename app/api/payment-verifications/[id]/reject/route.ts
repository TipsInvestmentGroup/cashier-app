import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { rejectPaymentVerification } from '@/lib/payment-verification'

/** POST — mark a payment verification FAILED. Body: { failureReason }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.VERIFY_PAYMENT))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!body.failureReason) return NextResponse.json({ error: 'failureReason is required' }, { status: 400 })

  const record = await rejectPaymentVerification(id, { userId: user.userId }, body.failureReason)
  return NextResponse.json({ ok: true, paymentVerification: record })
}
