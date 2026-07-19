import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { listShiftTemplates, upsertShiftTemplate, deleteShiftTemplate } from '@/lib/business-calendar'
import { CALENDAR_SCOPES, isValidHHmm, type CalendarScope } from '@/lib/business-calendar-shared'

/** GET — shift templates for a scope. ?scope=&scopeId= (scope required) */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const scope = searchParams.get('scope') as CalendarScope | null
  const scopeId = searchParams.get('scopeId')
  if (!scope || !CALENDAR_SCOPES.includes(scope)) return NextResponse.json({ error: `scope must be one of ${CALENDAR_SCOPES.join(', ')}` }, { status: 400 })

  const rows = await listShiftTemplates(scope, scopeId)
  return NextResponse.json(rows)
}

/** POST — create/update a shift template. Body: { id?, scope, scopeId?, name, startTime, endTime, sortOrder? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const scope = body.scope as CalendarScope
  const scopeId = body.scopeId ? String(body.scopeId) : null
  const name = typeof body.name === 'string' ? body.name.trim() : ''

  if (!CALENDAR_SCOPES.includes(scope)) return NextResponse.json({ error: `scope must be one of ${CALENDAR_SCOPES.join(', ')}` }, { status: 400 })
  if (scope !== 'GLOBAL' && !scopeId) return NextResponse.json({ error: 'scopeId is required for a non-GLOBAL scope' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
  if (!isValidHHmm(body.startTime) || !isValidHHmm(body.endTime)) return NextResponse.json({ error: 'startTime/endTime must be valid HH:mm values' }, { status: 400 })
  if (scope === 'OUTLET' && !(await prisma.outlet.findUnique({ where: { id: scopeId! } }))) return NextResponse.json({ error: 'Outlet not found' }, { status: 404 })
  if (scope === 'COMPANY' && !(await prisma.company.findUnique({ where: { id: scopeId! } }))) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const row = await upsertShiftTemplate({ id: body.id, scope, scopeId, name, startTime: body.startTime, endTime: body.endTime, sortOrder: Number(body.sortOrder) || 0 })
  return NextResponse.json(row)
}

/** DELETE — remove a shift template. ?id= */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await deleteShiftTemplate(id)
  return NextResponse.json({ ok: true })
}
