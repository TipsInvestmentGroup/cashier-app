import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { markPaymentVerificationDuplicate } from '@/lib/payment-verification'

/** POST — mark a payment verification DUPLICATE of another record. Body: { duplicateOfId }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.VERIFY_PAYMENT))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (!body.duplicateOfId) return NextResponse.json({ error: 'duplicateOfId is required' }, { status: 400 })

  const record = await markPaymentVerificationDuplicate(id, body.duplicateOfId)
  return NextResponse.json({ ok: true, paymentVerification: record })
}
