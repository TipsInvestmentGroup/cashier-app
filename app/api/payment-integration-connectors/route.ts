import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'

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
  return NextResponse.json({ connectors })
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

  const connector = await prisma.paymentIntegrationConnector.create({
    data: { companyId, name: body.name, kind: body.kind, channel: body.channel, config: body.config ? JSON.stringify(body.config) : null },
  })
  return NextResponse.json({ ok: true, connector })
}
