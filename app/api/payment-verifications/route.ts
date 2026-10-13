import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, NO_OUTLET } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { tenantCompanyId, outletInCompany } from '@/lib/tenant'
import { createPaymentVerification } from '@/lib/payment-verification'

/** GET — list payment verifications. Filters: companyId, outletId, status, channel, from, to. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.VERIFY_PAYMENT))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)
  if (outletId === NO_OUTLET) return NextResponse.json({ paymentVerifications: [] })

  const companyId = await tenantCompanyId(user, searchParams.get('companyId'))
  if (!companyId) return NextResponse.json({ paymentVerifications: [] })

  const status = searchParams.get('status')
  const channel = searchParams.get('channel')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const where: Record<string, unknown> = { companyId }
  if (outletId) where.outletId = outletId
  if (status) where.status = status
  if (channel) where.channel = channel
  if (from || to) where.date = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) }

  const paymentVerifications = await prisma.paymentVerification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 })
  return NextResponse.json({ paymentVerifications })
}

/** POST — manual entry of a payment verification. Body: { outletId?, date, reference?, channel, amount, customerName?, paidAt? }. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.VERIFY_PAYMENT))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!body.date || !body.channel || body.amount == null) {
    return NextResponse.json({ error: 'date, channel, and amount are required' }, { status: 400 })
  }

  const outletId = body.outletId ? readOutletScope(user, body.outletId) : null
  if (outletId === NO_OUTLET) return NextResponse.json({ error: 'No outlet access' }, { status: 403 })

  const companyId = await tenantCompanyId(user, body.companyId)
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })
  if (outletId && !(await outletInCompany(prisma, outletId, companyId))) {
    return NextResponse.json({ error: 'Outlet does not belong to your company' }, { status: 400 })
  }

  const record = await createPaymentVerification({
    companyId,
    outletId,
    date: new Date(body.date),
    reference: body.reference ?? null,
    channel: body.channel,
    amount: Number(body.amount),
    customerName: body.customerName ?? null,
    paidAt: body.paidAt ? new Date(body.paidAt) : null,
    source: 'MANUAL',
  })
  return NextResponse.json({ ok: true, paymentVerification: record })
}
