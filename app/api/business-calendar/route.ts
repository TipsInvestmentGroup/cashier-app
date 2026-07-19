import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { CALENDAR_SCOPES, type CalendarScope, validateBusinessCalendarFields, normalizeBusinessCalendarFields } from '@/lib/business-calendar-shared'
import { setBusinessCalendarConfig, listBusinessCalendarConfigs } from '@/lib/business-calendar'

/** GET — list every configured Business Calendar row (ADMIN-only; Business Calendar Settings page). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await listBusinessCalendarConfigs()
  return NextResponse.json(rows)
}

/** PUT — create/update one scope's calendar config. Body: { scope, scopeId?, ...fields, reason? } */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const scope = body.scope as CalendarScope
  const scopeId = body.scopeId ? String(body.scopeId) : null

  if (!CALENDAR_SCOPES.includes(scope)) return NextResponse.json({ error: `scope must be one of ${CALENDAR_SCOPES.join(', ')}` }, { status: 400 })
  if (scope !== 'GLOBAL' && !scopeId) return NextResponse.json({ error: 'scopeId is required for a non-GLOBAL scope' }, { status: 400 })
  if (scope === 'OUTLET' && !(await prisma.outlet.findUnique({ where: { id: scopeId! } }))) return NextResponse.json({ error: 'Outlet not found' }, { status: 404 })
  if (scope === 'COMPANY' && !(await prisma.company.findUnique({ where: { id: scopeId! } }))) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const fields = normalizeBusinessCalendarFields(body)
  const problems = validateBusinessCalendarFields(fields)
  if (problems.length) return NextResponse.json({ error: problems.join(' ') }, { status: 400 })

  const row = await setBusinessCalendarConfig(scope, scopeId, fields, {
    userId: user.userId,
    userName: user.name || user.email,
    reason: typeof body.reason === 'string' ? body.reason : null,
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'BusinessCalendarConfig', entityId: row.id, details: `Set ${scope}${scopeId ? `:${scopeId}` : ''} business calendar` },
  })

  return NextResponse.json(row)
}

/** DELETE — remove a COMPANY/OUTLET override row, falling back to the next-widest scope. ?id= */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await prisma.businessCalendarConfig.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.scope === 'GLOBAL') return NextResponse.json({ error: 'The Global default cannot be removed — edit it instead' }, { status: 409 })

  await prisma.businessCalendarConfig.delete({ where: { id } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'BusinessCalendarConfig', entityId: id, details: `Removed ${existing.scope}:${existing.scopeId} calendar override` },
  })
  return NextResponse.json({ ok: true })
}
