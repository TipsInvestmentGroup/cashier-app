import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { replenishFundingSource } from '@/lib/expense-ledger'

/**
 * POST — ADMIN-ONLY direct allocation, no approval (§8's override path). Since
 * the upgrade, top-ups go through the request flow (POST .../top-up) so every
 * allocation has an approval trail; this remains only as an admin escape hatch
 * for corrections and edge cases, and each entry is flagged in the ledger note
 * as an unapproved override so the audit trail shows it bypassed the chain.
 *
 * Restricted to ADMIN — previously ACCOUNTANT/MANAGER/DIRECTOR could allocate
 * directly; that route is now the approved top-up request, not this one.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Direct allocation is an admin override — request a top-up instead' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const amount = Number(body.amount)
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 })

  const providedNote = body.note ? String(body.note) : ''
  try {
    const source = await replenishFundingSource({
      fundingSourceId: id, amount,
      reference: body.reference ? String(body.reference) : null,
      note: `[Admin override — no approval]${providedNote ? ` ${providedNote}` : ''}`,
      createdById: user.userId, createdByName: user.name,
    })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'FundingSourceTxn', entityId: id, details: `Admin override allocation of ${amount} (no approval)` },
    })
    return NextResponse.json(source, { status: 201 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not replenish funding source' }, { status: 400 })
  }
}
