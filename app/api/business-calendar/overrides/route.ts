import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { listBusinessCalendarOverrides, createBusinessCalendarOverride, deleteBusinessCalendarOverride } from '@/lib/business-calendar'
import { CALENDAR_SCOPES, isValidHHmm, type CalendarScope } from '@/lib/business-calendar-shared'

/** GET — temporary overrides for a scope. ?scope=&scopeId= (scope required) */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const scope = searchParams.get('scope') as CalendarScope | null
  const scopeId = searchParams.get('scopeId')
  if (!scope || !CALENDAR_SCOPES.includes(scope)) return NextResponse.json({ error: `scope must be one of ${CALENDAR_SCOPES.join(', ')}` }, { status: 400 })

  const rows = await listBusinessCalendarOverrides(scope, scopeId)
  return NextResponse.json(rows)
}

/** POST — create a temporary override. Body: { scope, scopeId?, startDate, endDate, businessDayStartTime?, businessDayEndTime?, reason? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const scope = body.scope as CalendarScope
  const scopeId = body.scopeId ? String(body.scopeId) : null
  const startDate = new Date(body.startDate)
  const endDate = new Date(body.endDate)

  if (!CALENDAR_SCOPES.includes(scope)) return NextResponse.json({ error: `scope must be one of ${CALENDAR_SCOPES.join(', ')}` }, { status: 400 })
  if (scope !== 'GLOBAL' && !scopeId) return NextResponse.json({ error: 'scopeId is required for a non-GLOBAL scope' }, { status: 400 })
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate < startDate) return NextResponse.json({ error: 'endDate must be on or after startDate' }, { status: 400 })
  if (body.businessDayStartTime && !isValidHHmm(body.businessDayStartTime)) return NextResponse.json({ error: 'businessDayStartTime must be a valid HH:mm value' }, { status: 400 })
  if (body.businessDayEndTime && !isValidHHmm(body.businessDayEndTime)) return NextResponse.json({ error: 'businessDayEndTime must be a valid HH:mm value' }, { status: 400 })
  if (scope === 'OUTLET' && !(await prisma.outlet.findUnique({ where: { id: scopeId! } }))) return NextResponse.json({ error: 'Outlet not found' }, { status: 404 })
  if (scope === 'COMPANY' && !(await prisma.company.findUnique({ where: { id: scopeId! } }))) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const row = await createBusinessCalendarOverride({
    scope, scopeId, startDate, endDate,
    businessDayStartTime: body.businessDayStartTime || undefined,
    businessDayEndTime: body.businessDayEndTime || undefined,
    reason: body.reason || undefined,
    createdBy: user.name || user.email,
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'BusinessCalendarOverride', entityId: row.id, details: `Override ${scope}${scopeId ? `:${scopeId}` : ''} ${body.startDate}–${body.endDate}` },
  })

  return NextResponse.json(row)
}

/** DELETE — remove an override before it expires. ?id= */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await deleteBusinessCalendarOverride(id)
  return NextResponse.json({ ok: true })
}
