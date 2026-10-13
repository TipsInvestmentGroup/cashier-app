import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createPaymentVerification } from '@/lib/payment-verification'
import { parseConnectorConfig, verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from '@/lib/webhook-signature'
import { clientIp, limitEveryRequest } from '@/lib/rate-limit'

/**
 * POST — inbound webhook for an API_WEBHOOK connector. No session auth (the caller
 * is an external bank/MoMo/gateway, not a logged-in user) — instead every request
 * must carry an HMAC-SHA256 signature of the RAW body, computed with the
 * connector's per-connector `webhookSecret`, in the `x-signature` header. Without
 * that, anyone who learned a connector id could forge payment evidence.
 *
 * Fails CLOSED: a connector that has no signing secret yet accepts nothing until an
 * admin rotates/creates one (Payment Integration Connectors page).
 * Provider-specific schemes (other header names / canonicalisation) are an adapter
 * on top of this baseline - see docs/reconciliation-workflow-engine-design.md §12.3.
 * Body: { reference?, amount, customerName?, paidAt?, date }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Unauthenticated endpoint: cap the request rate per client before doing any DB work.
  const limited = limitEveryRequest(req, `webhook:${clientIp(req)}`, { limit: 120, windowMs: 60 * 1000 })
  if (limited) return limited

  const { id } = await params
  const connector = await prisma.paymentIntegrationConnector.findUnique({ where: { id } })
  // Same response for "no such connector" and "bad signature" below would hide whether an id
  // exists; unknown/inactive/wrong-kind is a 404 as before, signature problems are 401.
  if (!connector || !connector.isActive || connector.kind !== 'API_WEBHOOK') {
    return NextResponse.json({ error: 'Connector not found or inactive' }, { status: 404 })
  }

  const rawBody = await req.text()
  const secret = parseConnectorConfig(connector.config).webhookSecret
  if (typeof secret !== 'string' || !secret) {
    return NextResponse.json({ error: 'Webhook signing secret not configured for this connector' }, { status: 401 })
  }
  if (!verifyWebhookSignature(secret, rawBody, req.headers.get(WEBHOOK_SIGNATURE_HEADER))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  try { body = rawBody ? JSON.parse(rawBody) : {} } catch { /* handled by the amount check below */ }
  if (body.amount == null) return NextResponse.json({ error: 'amount is required' }, { status: 400 })
  const amount = Number(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'amount must be a positive number' }, { status: 400 })

  const record = await createPaymentVerification({
    companyId: connector.companyId,
    date: body.date ? new Date(String(body.date)) : new Date(),
    reference: body.reference != null ? String(body.reference) : null,
    channel: connector.channel,
    amount,
    customerName: body.customerName != null ? String(body.customerName) : null,
    paidAt: body.paidAt ? new Date(String(body.paidAt)) : new Date(),
    source: 'API',
    // createPaymentVerification treats sourceRef as an update-in-place key, so it must be unique
    // PER PAYMENT (a bare connector id made every payment overwrite the previous one). The provider's
    // own reference when given, else a hash of the exact body - so a provider retry of the same
    // notification is idempotent while distinct payments stay distinct.
    sourceRef: `webhook:${connector.id}:${body.reference != null ? String(body.reference) : createHash('sha256').update(rawBody).digest('hex').slice(0, 32)}`,
  })

  await prisma.paymentIntegrationConnector.update({ where: { id: connector.id }, data: { lastSyncAt: new Date() } })
  return NextResponse.json({ ok: true, paymentVerification: record })
}
