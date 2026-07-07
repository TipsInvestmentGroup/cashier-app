import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, SPONSORSHIP_TYPES, SPONSOR_AGREEMENT_STATUSES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** POST /api/events/[id]/sponsors — add a sponsor. body: { sponsorName, contactPerson?, phone?, email?, sponsorshipType?, sponsorshipValue?, itemsProvided?, agreementStatus?, notes? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const event = await db.event.findUnique({ where: { id } })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!body.sponsorName?.trim()) return NextResponse.json({ error: 'Sponsor name is required' }, { status: 400 })
  const sponsorshipType = SPONSORSHIP_TYPES.includes(body.sponsorshipType) ? body.sponsorshipType : 'CASH'
  const agreementStatus = SPONSOR_AGREEMENT_STATUSES.includes(body.agreementStatus) ? body.agreementStatus : 'PENDING'

  const item = await db.eventSponsor.create({
    data: {
      eventId: id,
      sponsorName: body.sponsorName.trim(),
      contactPerson: body.contactPerson?.trim() || null,
      phone: body.phone?.trim() || null,
      email: body.email?.trim() || null,
      sponsorshipType,
      sponsorshipValue: roundMoney(Number(body.sponsorshipValue) || 0),
      itemsProvided: body.itemsProvided?.trim() || null,
      agreementStatus,
      notes: body.notes?.trim() || null,
      createdById: user.userId,
    },
  })
  return NextResponse.json(item, { status: 201 })
}

/** PATCH /api/events/[id]/sponsors — update a sponsor line. body: { sponsorId, ...fields } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const body = await req.json().catch(() => ({}))
  if (!body.sponsorId) return NextResponse.json({ error: 'sponsorId is required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.sponsorName !== undefined) data.sponsorName = String(body.sponsorName).trim()
  if (body.contactPerson !== undefined) data.contactPerson = body.contactPerson?.trim() || null
  if (body.phone !== undefined) data.phone = body.phone?.trim() || null
  if (body.email !== undefined) data.email = body.email?.trim() || null
  if (body.sponsorshipValue !== undefined) data.sponsorshipValue = roundMoney(Number(body.sponsorshipValue) || 0)
  if (body.itemsProvided !== undefined) data.itemsProvided = body.itemsProvided?.trim() || null
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null
  if (body.sponsorshipType !== undefined) {
    if (!SPONSORSHIP_TYPES.includes(body.sponsorshipType)) return NextResponse.json({ error: 'Invalid sponsorship type' }, { status: 400 })
    data.sponsorshipType = body.sponsorshipType
  }
  if (body.agreementStatus !== undefined) {
    if (!SPONSOR_AGREEMENT_STATUSES.includes(body.agreementStatus)) return NextResponse.json({ error: 'Invalid agreement status' }, { status: 400 })
    data.agreementStatus = body.agreementStatus
  }

  const item = await db.eventSponsor.update({ where: { id: body.sponsorId }, data })
  return NextResponse.json(item)
}

/** DELETE /api/events/[id]/sponsors?sponsorId= */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await params
  const sponsorId = new URL(req.url).searchParams.get('sponsorId')
  if (!sponsorId) return NextResponse.json({ error: 'sponsorId required' }, { status: 400 })
  await db.eventSponsor.delete({ where: { id: sponsorId } })
  return NextResponse.json({ ok: true })
}
