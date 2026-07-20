import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, RECONCILIATION_STAGE_RESOURCES } from '@/lib/rbac'
import { createPaymentVerification } from '@/lib/payment-verification'

/**
 * POST — batch file import for a FILE_IMPORT connector. Expects the caller
 * to have already parsed the file client-side (CSV/Excel parsing is a
 * separate concern) into a row array. Body: { rows: [{ reference?, amount,
 * date, customerName?, paidAt? }] }.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, RECONCILIATION_STAGE_RESOURCES.MANAGE_RECONCILIATION_CONFIG))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const connector = await prisma.paymentIntegrationConnector.findUnique({ where: { id } })
  if (!connector || connector.kind !== 'FILE_IMPORT') return NextResponse.json({ error: 'Connector not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const rows: Array<{ reference?: string; amount: number; date: string; customerName?: string; paidAt?: string }> = body.rows || []
  if (!rows.length) return NextResponse.json({ error: 'rows is required and must be non-empty' }, { status: 400 })

  const created = []
  for (const row of rows) {
    created.push(
      await createPaymentVerification({
        companyId: connector.companyId,
        date: new Date(row.date),
        reference: row.reference ?? null,
        channel: connector.channel,
        amount: Number(row.amount),
        customerName: row.customerName ?? null,
        paidAt: row.paidAt ? new Date(row.paidAt) : null,
        source: 'IMPORT',
        sourceRef: connector.id,
      })
    )
  }

  await prisma.paymentIntegrationConnector.update({ where: { id: connector.id }, data: { lastSyncAt: new Date() } })
  return NextResponse.json({ ok: true, imported: created.length, paymentVerifications: created })
}
