import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/expense-config'
import { createTopUpRequest } from '@/lib/expense-topup'
import { hasGrant } from '@/lib/expense-grants'
import { fundClassOf } from '@/lib/expense-funds'

/**
 * POST — request a top-up for a petty cash fund (§8). The custodian is the
 * requester; this replaces the old direct "record allocation" for everyone but
 * an admin override. Authorized on Petty Cash Custodian access for THIS fund's
 * class and outlet (ADMIN always allowed) — the single-source-of-truth §4 grant,
 * not a job title.
 *
 * Creates a direction=IN request and submits it in one atomic step: a
 * below-threshold top-up is allocated immediately, anything above enters the
 * First → Second Approver chain, whose final approval executes the allocation.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const source = await prisma.fundingSource.findUnique({ where: { id }, select: { sourceType: true, outletId: true, name: true } })
  if (!source) return NextResponse.json({ error: 'Funding source not found' }, { status: 404 })

  const fundClass = fundClassOf(source.sourceType)
  const isCustodian = user.role === 'ADMIN' || (await hasGrant(user.userId, 'CUSTODIAN', { fundClass, outletId: source.outletId }))
  if (!isCustodian) {
    return NextResponse.json({ error: `You need Custodian access for ${source.name} to request a top-up. Ask an admin to grant it under Manage Access.` }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const amount = Number(body.amount)
  if (!amount || amount <= 0) return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 400 })

  const companyId = await resolveCompanyId(prisma, source.outletId)
  if (!companyId) return NextResponse.json({ error: 'No company configured' }, { status: 400 })

  try {
    const result = await prisma.$transaction((tx) => createTopUpRequest(tx, {
      companyId,
      fundingSourceId: id,
      requestedById: user.userId,
      amount,
      reference: body.reference ? String(body.reference) : null,
      note: body.note ? String(body.note) : null,
    }))
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'CREATE', entity: 'ExpenseRequest', entityId: result.id, details: `Requested top-up of ${amount} for ${source.name} → ${result.status}` },
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not request top-up' }, { status: 400 })
  }
}
