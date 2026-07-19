import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, writeOutletId, CASHIER_ROLES } from '@/lib/auth'
import { resolveBusinessDate, resolveEffectiveConfig } from '@/lib/business-calendar'
import { startOfDay, endOfDay } from 'date-fns'

const ALLOWED = ['CASHIER', 'ADMIN', 'ACCOUNTANT']

/** List sessions for an outlet/date range, with stage-completion counts for the progress dashboard. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CASHIER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const requestedOutletId = searchParams.get('outletId')
  const outletId = readOutletScope(user, requestedOutletId)
  const dateParam = searchParams.get('date')

  const sessions = await prisma.collectionSession.findMany({
    where: {
      ...(outletId ? { outletId } : {}),
      ...(dateParam ? { date: { gte: startOfDay(new Date(dateParam)), lte: endOfDay(new Date(dateParam)) } } : {}),
    },
    include: {
      template: {
        select: {
          id: true, name: true, code: true, description: true,
          stages: { select: { id: true, key: true, label: true, order: true }, orderBy: { order: 'asc' } },
        },
      },
      outlet: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      completedBy: { select: { id: true, name: true } },
      stageRecords: { select: { id: true, status: true, stageId: true, updatedAt: true } },
    },
    orderBy: { date: 'desc' },
  })

  return NextResponse.json(sessions)
}

/** Get-or-create a session for outlet/date/template — idempotent so re-posting the same day just returns the existing session. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ALLOWED.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const outletId = writeOutletId(user, body.outletId)
  if (!outletId) return NextResponse.json({ error: 'Outlet is required' }, { status: 400 })
  if (!body.templateId) return NextResponse.json({ error: 'Template is required' }, { status: 400 })

  const template = await prisma.collectionTemplate.findUnique({ where: { id: body.templateId } })
  if (!template || !template.isActive) return NextResponse.json({ error: 'Template not found or inactive' }, { status: 404 })
  if (template.isDefault) return NextResponse.json({ error: 'The Standard template uses the Daily Collections screen directly — no session needed.' }, { status: 400 })

  const day = body.date ? startOfDay(new Date(body.date)) : resolveBusinessDate(new Date(), await resolveEffectiveConfig({ outletId }))

  const existing = await prisma.collectionSession.findUnique({
    where: { outletId_date_templateId: { outletId, date: day, templateId: template.id } },
  })
  if (existing) return NextResponse.json(existing)

  const session = await prisma.collectionSession.create({
    data: { outletId, date: day, templateId: template.id, createdById: user.userId },
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'CollectionSession', entityId: session.id, details: `Opened ${template.name} session for ${day.toDateString()}` },
  })
  return NextResponse.json(session, { status: 201 })
}
