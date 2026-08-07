import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { getFundingSourceBalance } from '@/lib/expense-ledger'
import { formatCurrency } from '@/lib/utils'

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

/**
 * DELETE — three modes via ?mode=:
 *   (none)    soft-delete / Deactivate (isActive → false) — reversible.
 *   archive   permanently retire but keep the row (archived → true) so linked
 *             payments stay readable; hidden from every live list.
 *   hard      permanently remove the row. Refused (409) if the fund still holds
 *             a non-zero balance, or has any linked payment (archive instead).
 * Every gate is re-evaluated server-side from the live balance + payment count;
 * the client's read of them is never trusted.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.fundingSource.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Funding source not found' }, { status: 404 })

  const mode = req.nextUrl.searchParams.get('mode')

  if (mode === 'hard') {
    // §Balance gate — a fund carrying money (in either direction) must be
    // reconciled to zero before it can leave the system. Computed live, same as
    // the list screen, so CASH/BANK/CASHIER_DRAWER all resolve correctly.
    const balance = await getFundingSourceBalance(prisma, existing)
    if (Math.abs(balance) >= 0.01) {
      return NextResponse.json({ error: `Can't delete — this funding source still holds ${formatCurrency(balance)}. Move or reconcile the balance to zero before deleting.` }, { status: 409 })
    }
    // §History gate — any disbursement history means the row must be preserved.
    const payments = await prisma.expensePayment.count({ where: { fundingSourceId: id } })
    if (payments > 0) {
      return NextResponse.json({ error: `${existing.name} has ${payments} linked payment(s) and can't be permanently deleted. Archive it instead.` }, { status: 409 })
    }
    // Safe to purge. Custodians and ledger txns are owned by this fund (Restrict
    // FKs) so clear them in the same transaction; unpaid requests that point at
    // it have a nullable FK and are released to null by the DB.
    await prisma.$transaction([
      prisma.fundingSourceCustodian.deleteMany({ where: { fundingSourceId: id } }),
      prisma.fundingSourceTxn.deleteMany({ where: { fundingSourceId: id } }),
      prisma.expenseRequest.updateMany({ where: { fundingSourceId: id }, data: { fundingSourceId: null } }),
      prisma.fundingSource.delete({ where: { id } }),
    ])
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'DELETE', entity: 'FundingSource', entityId: id, details: `Permanently deleted funding source ${existing.name}` },
    })
    return NextResponse.json({ ok: true, action: 'deleted' })
  }

  if (mode === 'archive') {
    await prisma.fundingSource.update({ where: { id }, data: { archived: true, isActive: false } })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'FundingSource', entityId: id, details: `Archived funding source ${existing.name}` },
    })
    return NextResponse.json({ ok: true, action: 'archived' })
  }

  await prisma.fundingSource.update({ where: { id }, data: { isActive: false } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'FundingSource', entityId: id, details: `Deactivated funding source ${existing.name}` },
  })
  return NextResponse.json({ ok: true, action: 'deactivated' })
}
