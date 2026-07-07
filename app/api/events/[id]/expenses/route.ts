import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, EXPENSE_PAYMENT_STATUSES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** POST /api/events/[id]/expenses — add a budget/cost line. body: { category, description?, estimatedCost?, amount, supplier?, paymentStatus? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const amount = roundMoney(Number(body.amount) || 0)
  const estimatedCost = roundMoney(Number(body.estimatedCost) || 0)
  if (!body.category?.trim()) return NextResponse.json({ error: 'Category is required' }, { status: 400 })
  if (!(amount > 0) && !(estimatedCost > 0)) return NextResponse.json({ error: 'Enter an estimated or actual amount greater than zero' }, { status: 400 })
  const paymentStatus = EXPENSE_PAYMENT_STATUSES.includes(body.paymentStatus) ? body.paymentStatus : 'UNPAID'

  const item = await db.eventExpense.create({
    data: {
      eventId: id,
      category: body.category.trim(),
      description: body.description?.trim() || null,
      estimatedCost,
      amount,
      supplier: body.supplier?.trim() || null,
      paymentStatus,
      createdById: user.userId,
    },
  })
  return NextResponse.json(item, { status: 201 })
}

/** PATCH /api/events/[id]/expenses — update a budget/cost line. body: { expenseId, ...fields } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const body = await req.json().catch(() => ({}))
  if (!body.expenseId) return NextResponse.json({ error: 'expenseId is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.category !== undefined) data.category = String(body.category).trim()
  if (body.description !== undefined) data.description = body.description?.trim() || null
  if (body.estimatedCost !== undefined) data.estimatedCost = roundMoney(Number(body.estimatedCost) || 0)
  if (body.amount !== undefined) data.amount = roundMoney(Number(body.amount) || 0)
  if (body.supplier !== undefined) data.supplier = body.supplier?.trim() || null
  if (body.paymentStatus !== undefined) {
    if (!EXPENSE_PAYMENT_STATUSES.includes(body.paymentStatus)) return NextResponse.json({ error: 'Invalid payment status' }, { status: 400 })
    data.paymentStatus = body.paymentStatus
  }

  const item = await db.eventExpense.update({ where: { id: body.expenseId }, data })
  return NextResponse.json(item)
}

/** DELETE /api/events/[id]/expenses?expenseId= */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const expenseId = new URL(req.url).searchParams.get('expenseId')
  if (!expenseId) return NextResponse.json({ error: 'expenseId required' }, { status: 400 })
  await db.eventExpense.delete({ where: { id: expenseId } })
  return NextResponse.json({ ok: true })
}
