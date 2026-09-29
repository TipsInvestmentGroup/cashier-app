import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'
import { isDayLocked } from '@/lib/day-lock'
import { referenceKeyFor, assertReferenceFree, DuplicateReferenceError } from '@/lib/collection-ledger'

/** Shared guards: owner (or admin), still DECLARED, not yet in a collection, day open. */
async function loadEditable(req: NextRequest, id: string, verb: 'edited' | 'deleted') {
  const user = getAuthUser(req)
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const existing = await prisma.staffTransaction.findUnique({ where: { id } })
  if (!existing) return { error: NextResponse.json({ error: 'Transaction not found' }, { status: 404 }) }
  if (existing.staffId !== user.userId && user.role !== 'ADMIN') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  if (existing.status !== 'DECLARED' || existing.lockedAt || existing.collectionId) {
    return { error: NextResponse.json({ error: `Only a still-declared transaction can be ${verb}` }, { status: 409 }) }
  }
  if (existing.outletId && existing.date && await isDayLocked(prisma, existing.outletId, existing.date)) {
    return { error: NextResponse.json({ error: `This business day is closed — the transaction can no longer be ${verb}.` }, { status: 423 }) }
  }
  return { user, existing }
}

/** PUT — edit a still-DECLARED transaction the caller owns. Body: { amount?, paymentMethod?, receivingAccount?, reference?, personName? } */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadEditable(req, id, 'edited')
  if ('error' in loaded) return loaded.error
  const { existing } = loaded

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (body.amount !== undefined) data.amount = roundMoney(Number(body.amount) || 0)
  if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod ? String(body.paymentMethod) : null
  if (body.receivingAccount !== undefined) data.receivingAccount = body.receivingAccount ? String(body.receivingAccount) : null
  if (body.reference !== undefined) data.reference = body.reference ? String(body.reference) : null
  if (body.personName !== undefined) data.personName = body.personName ? String(body.personName).trim() : null

  const referenceKey = await referenceKeyFor(prisma, {
    outletId: existing.outletId,
    category: existing.category,
    paymentMethod: (data.paymentMethod !== undefined ? data.paymentMethod : existing.paymentMethod) as string | null,
    reference: (data.reference !== undefined ? data.reference : existing.reference) as string | null,
  })
  data.referenceKey = referenceKey

  try {
    await assertReferenceFree(prisma, referenceKey, id)
    const updated = await prisma.staffTransaction.update({ where: { id }, data })
    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof DuplicateReferenceError) return NextResponse.json({ error: e.message }, { status: 409 })
    if ((e as { code?: string })?.code === 'P2002') return NextResponse.json({ error: 'That payment reference has already been recorded.' }, { status: 409 })
    throw e
  }
}

/** DELETE — remove a still-DECLARED transaction the caller owns. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const loaded = await loadEditable(req, id, 'deleted')
  if ('error' in loaded) return loaded.error

  await prisma.staffTransaction.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
