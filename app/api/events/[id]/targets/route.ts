import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, EVENT_TARGET_TYPES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** POST /api/events/[id]/targets — add a sales or procurement target. body: { type, name, targetValue?, actualValue?, unit?, notes? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!EVENT_TARGET_TYPES.includes(body.type)) return NextResponse.json({ error: 'type must be SALES or PROCUREMENT' }, { status: 400 })
  if (!body.name?.trim()) return NextResponse.json({ error: 'Target name is required' }, { status: 400 })

  const item = await db.eventTarget.create({
    data: {
      eventId: id,
      type: body.type,
      name: body.name.trim(),
      targetValue: roundMoney(Number(body.targetValue) || 0),
      actualValue: roundMoney(Number(body.actualValue) || 0),
      unit: body.unit?.trim() || null,
      notes: body.notes?.trim() || null,
    },
  })
  return NextResponse.json(item, { status: 201 })
}

/** PATCH /api/events/[id]/targets — update a target. body: { targetId, targetValue?, actualValue?, name?, unit?, notes? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const body = await req.json().catch(() => ({}))
  if (!body.targetId) return NextResponse.json({ error: 'targetId is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.targetValue !== undefined) data.targetValue = roundMoney(Number(body.targetValue) || 0)
  if (body.actualValue !== undefined) data.actualValue = roundMoney(Number(body.actualValue) || 0)
  if (body.unit !== undefined) data.unit = body.unit?.trim() || null
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null

  const item = await db.eventTarget.update({ where: { id: body.targetId }, data })
  return NextResponse.json(item)
}

/** DELETE /api/events/[id]/targets?targetId= */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const targetId = new URL(req.url).searchParams.get('targetId')
  if (!targetId) return NextResponse.json({ error: 'targetId required' }, { status: 400 })
  await db.eventTarget.delete({ where: { id: targetId } })
  return NextResponse.json({ ok: true })
}
