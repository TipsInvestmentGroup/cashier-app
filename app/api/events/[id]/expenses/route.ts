import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** POST /api/events/[id]/expenses — add an expense line. body: { category, description?, amount } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const amount = roundMoney(Number(body.amount) || 0)
  if (!body.category?.trim()) return NextResponse.json({ error: 'Category is required' }, { status: 400 })
  if (!(amount > 0)) return NextResponse.json({ error: 'Enter an amount greater than zero' }, { status: 400 })

  const item = await db.eventExpense.create({
    data: { eventId: id, category: body.category.trim(), description: body.description?.trim() || null, amount, createdById: user.userId },
  })
  return NextResponse.json(item, { status: 201 })
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
