import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { generateWebhookSecret, redactConnector } from '@/lib/webhook-signature'

/** GET — list connectors for a company (API_WEBHOOK | FILE_IMPORT). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ connectors: [] })

  const connectors = await prisma.paymentIntegrationConnector.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } })
  // The webhook signing secret is never returned after creation.
  return NextResponse.json({ connectors: connectors.map(redactConnector) })
}

/** POST — register a connector. Body: { companyId?, name, kind, channel, config? }. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  if (!body.name || !body.kind || !body.channel) return NextResponse.json({ error: 'name, kind, and channel are required' }, { status: 400 })

  const companyId = body.companyId || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company found' }, { status: 400 })

  // Webhook connectors get a per-connector HMAC signing secret. It is stored in `config`, shown to
  // the admin exactly once here (they paste it into the bank/gateway's webhook settings), and
  // redacted on every later read. Callers cannot supply their own (a weak or reused one).
  const config: Record<string, unknown> = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? { ...body.config } : {}
  delete config.webhookSecret
  let webhookSecret: string | undefined
  if (body.kind === 'API_WEBHOOK') { webhookSecret = generateWebhookSecret(); config.webhookSecret = webhookSecret }

  const connector = await prisma.paymentIntegrationConnector.create({
    data: { companyId, name: body.name, kind: body.kind, channel: body.channel, config: Object.keys(config).length ? JSON.stringify(config) : null },
  })
  return NextResponse.json({ ok: true, connector: redactConnector(connector), ...(webhookSecret ? { webhookSecret } : {}) })
}
