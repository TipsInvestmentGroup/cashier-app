import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/**
 * PATCH — update a funding source's editable fields. sourceType is
 * intentionally not editable here (switching CASH↔BANK mid-life would orphan
 * the balance-ownership rule) — deactivate and create a new one instead.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.fundingSource.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Funding source not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body.outletId !== undefined) data.outletId = body.outletId ? String(body.outletId) : null
  if (body.dailyLimit !== undefined) data.dailyLimit = Number(body.dailyLimit) > 0 ? Number(body.dailyLimit) : 0
  if (body.responsibleUserId !== undefined) data.responsibleUserId = body.responsibleUserId ? String(body.responsibleUserId) : null
  if (body.currency !== undefined) data.currency = String(body.currency)
  if (body.isActive !== undefined) data.isActive = body.isActive === true

  // Per-fund approval + alert policy (§3/§7). Negative values are clamped to 0
  // rather than rejected, since 0 is the meaningful "off" for all three: no
  // threshold skip, no escalation reminders, no low-balance alert.
  if (body.approvalThreshold !== undefined) data.approvalThreshold = Math.max(0, Number(body.approvalThreshold) || 0)
  if (body.escalationHours !== undefined) data.escalationHours = Math.max(0, Math.floor(Number(body.escalationHours) || 0))
  if (body.lowBalanceThreshold !== undefined) data.lowBalanceThreshold = Math.max(0, Number(body.lowBalanceThreshold) || 0)

  const source = await prisma.fundingSource.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'FundingSource', entityId: id, details: `Updated funding source ${source.name}` },
  })
  return NextResponse.json(source)
}

/** DELETE — soft-delete (isActive → false); historical payments still reference it. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.fundingSource.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Funding source not found' }, { status: 404 })

  await prisma.fundingSource.update({ where: { id }, data: { isActive: false } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'FundingSource', entityId: id, details: `Deactivated funding source ${existing.name}` },
  })
  return NextResponse.json({ ok: true })
}
