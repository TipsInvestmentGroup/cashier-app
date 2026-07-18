import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { roundMoney } from '@/lib/utils'

/** PUT — edit a still-DECLARED transaction the caller owns. Body: { amount?, paymentMethod?, receivingAccount?, reference? } */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.staffTransaction.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  if (existing.staffId !== user.userId && user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (existing.status !== 'DECLARED') return NextResponse.json({ error: 'Only a still-declared transaction can be edited' }, { status: 409 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (body.amount !== undefined) data.amount = roundMoney(Number(body.amount) || 0)
  if (body.paymentMethod !== undefined) data.paymentMethod = body.paymentMethod ? String(body.paymentMethod) : null
  if (body.receivingAccount !== undefined) data.receivingAccount = body.receivingAccount ? String(body.receivingAccount) : null
  if (body.reference !== undefined) data.reference = body.reference ? String(body.reference) : null

  const updated = await prisma.staffTransaction.update({ where: { id }, data })
  return NextResponse.json(updated)
}

/** DELETE — remove a still-DECLARED transaction the caller owns. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const existing = await prisma.staffTransaction.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  if (existing.staffId !== user.userId && user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (existing.status !== 'DECLARED') return NextResponse.json({ error: 'Only a still-declared transaction can be deleted' }, { status: 409 })

  await prisma.staffTransaction.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
