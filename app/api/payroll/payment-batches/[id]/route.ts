import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildPaymentCsv, markBatchExported, markBatchPaid } from '@/lib/payroll-payment'

const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** GET — batch detail, or the payout file when `?format=csv` (also marks EXPORTED). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const batch = await prisma.paymentBatch.findUnique({ where: { id }, include: { instructions: true } })
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  if (searchParams.get('format') === 'csv') {
    const csv = buildPaymentCsv(batch)
    if (batch.status === 'PENDING') await markBatchExported(prisma, id)
    return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="payroll-${batch.runId}.csv"` } })
  }
  return NextResponse.json({ batch })
}

/** POST — { action: 'pay' } posts the settlement entry and marks the run PAID. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  if (body.action !== 'pay') return NextResponse.json({ error: "action must be 'pay'" }, { status: 400 })
  try {
    const batch = await markBatchPaid(prisma, id, { userId: user.userId, role: user.role, name: user.name })
    return NextResponse.json({ batch })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to mark paid' }, { status: 400 })
  }
}
