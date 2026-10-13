import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { tenantCompanyId } from '@/lib/tenant'
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
  const callerCompany = await tenantCompanyId(user)
  const found = await prisma.paymentVerification.findUnique({ where: { id }, select: { companyId: true } })
  if (!callerCompany || !found || found.companyId !== callerCompany) {
    return NextResponse.json({ error: 'Payment verification not found' }, { status: 404 })
  }
  if (body.matchedStageId) {
    const stage = await prisma.reconciliationStage.findUnique({ where: { id: body.matchedStageId }, select: { companyId: true } })
    if (!stage || stage.companyId !== callerCompany) {
      return NextResponse.json({ error: 'Reconciliation stage does not belong to your company' }, { status: 400 })
    }
  }
  try {
    const record = await verifyPaymentVerification(id, { userId: user.userId }, body.matchedStageId ?? null)
    return NextResponse.json({ ok: true, paymentVerification: record })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to verify payment' }, { status: 400 })
  }
}
