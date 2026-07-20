import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { verifyPaymentVerification } from '@/lib/payment-verification'

/** POST — mark a payment verification VERIFIED. Body: { matchedStageId? }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.VERIFY_PAYMENT))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  try {
    const record = await verifyPaymentVerification(id, { userId: user.userId }, body.matchedStageId ?? null)
    return NextResponse.json({ ok: true, paymentVerification: record })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to verify payment' }, { status: 400 })
  }
}
