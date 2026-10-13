import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { generateWebhookSecret, parseConnectorConfig, redactConnector } from '@/lib/webhook-signature'

/** PATCH — toggle a connector's active state. Body: { isActive }. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const connector = await prisma.paymentIntegrationConnector.update({ where: { id }, data: { isActive: !!body.isActive } })
  return NextResponse.json({ ok: true, connector: redactConnector(connector) })
}

/**
 * POST — rotate the webhook signing secret of an API_WEBHOOK connector. The new secret is
 * returned ONCE in this response; the previous one stops working immediately. Also the way to
 * give a connector created before signing existed its first secret.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const existing = await prisma.paymentIntegrationConnector.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Connector not found' }, { status: 404 })
  if (existing.kind !== 'API_WEBHOOK') return NextResponse.json({ error: 'Only API_WEBHOOK connectors have a signing secret' }, { status: 400 })

  const webhookSecret = generateWebhookSecret()
  const config = { ...parseConnectorConfig(existing.config), webhookSecret }
  const connector = await prisma.paymentIntegrationConnector.update({ where: { id }, data: { config: JSON.stringify(config) } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'ROTATE_WEBHOOK_SECRET', entity: 'PaymentIntegrationConnector', entityId: id, details: `Webhook signing secret rotated for "${existing.name}"` },
  })
  return NextResponse.json({ ok: true, connector: redactConnector(connector), webhookSecret })
}
