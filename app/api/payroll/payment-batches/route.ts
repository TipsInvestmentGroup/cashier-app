import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createPaymentBatch } from '@/lib/payroll-payment'

// Payment batches (Phase 5). Supervisor-gated. POST creates the batch for a
// POSTED run; GET lists batches (optionally by runId).
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const where: Record<string, unknown> = {}
  const runId = searchParams.get('runId')
  if (runId) where.runId = runId
  const batches = await prisma.paymentBatch.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100 })
  return NextResponse.json({ batches })
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (!body.runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 })
  try {
    const batch = await createPaymentBatch(prisma, body.runId, { userId: user.userId, role: user.role, name: user.name })
    return NextResponse.json({ batch }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to create batch' }, { status: 400 })
  }
}
