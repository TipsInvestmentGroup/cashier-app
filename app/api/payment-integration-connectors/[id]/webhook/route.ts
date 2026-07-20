import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createPaymentVerification } from '@/lib/payment-verification'

/**
 * POST — inbound webhook for an API_WEBHOOK connector. No session auth (the
 * caller is an external bank/MoMo/gateway, not a logged-in user) — instead
 * validates the connector is active. This is the Phase 1 extension point
 * only: a real deployment must add provider-specific signature verification
 * here (e.g. HMAC header check against connector.config) before trusting the
 * body — not implemented in this pass, see docs/reconciliation-workflow-engine-design.md §12.3.
 * Body: { reference?, amount, customerName?, paidAt?, date }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const connector = await prisma.paymentIntegrationConnector.findUnique({ where: { id } })
  if (!connector || !connector.isActive || connector.kind !== 'API_WEBHOOK') {
    return NextResponse.json({ error: 'Connector not found or inactive' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  if (body.amount == null) return NextResponse.json({ error: 'amount is required' }, { status: 400 })

  const record = await createPaymentVerification({
    companyId: connector.companyId,
    date: body.date ? new Date(body.date) : new Date(),
    reference: body.reference ?? null,
    channel: connector.channel,
    amount: Number(body.amount),
    customerName: body.customerName ?? null,
    paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
    source: 'API',
    sourceRef: connector.id,
  })

  await prisma.paymentIntegrationConnector.update({ where: { id: connector.id }, data: { lastSyncAt: new Date() } })
  return NextResponse.json({ ok: true, paymentVerification: record })
}
