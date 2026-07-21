import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { CALENDAR_SCOPES, type CalendarScope } from '@/lib/business-calendar-shared'
import { normalizeBusinessPeriodFields, validateBusinessPeriodFields, PERIOD_PRESETS } from '@/lib/business-periods-shared'
import { saveBusinessPeriodVersion, listBusinessPeriodVersions, deleteBusinessPeriodVersion } from '@/lib/business-periods'

/** GET — list every stored Business Period version (ADMIN-only). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await listBusinessPeriodVersions()
  return NextResponse.json(rows)
}

/** PUT — save a new effective-dated version for one scope.
 *  Body: { scope, scopeId?, effectiveDate, presetName?, ...fields, reason? } */
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

  const effectiveDate = body.effectiveDate ? new Date(body.effectiveDate) : new Date()
  if (Number.isNaN(effectiveDate.getTime())) return NextResponse.json({ error: 'effectiveDate is not a valid date' }, { status: 400 })

  const presetName = typeof body.presetName === 'string' && body.presetName in PERIOD_PRESETS ? body.presetName : 'CUSTOM'
  const fields = normalizeBusinessPeriodFields(body)
  const problems = validateBusinessPeriodFields(fields)
  if (problems.length) return NextResponse.json({ error: problems.join(' ') }, { status: 400 })

  const row = await saveBusinessPeriodVersion(scope, scopeId, fields, effectiveDate, presetName, {
    userId: user.userId,
    userName: user.name || user.email,
    reason: typeof body.reason === 'string' ? body.reason : null,
  })

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'BusinessPeriodVersion', entityId: row.id, details: `Saved ${scope}${scopeId ? `:${scopeId}` : ''} period version effective ${row.effectiveDate.toISOString().slice(0, 10)}` },
  })

  return NextResponse.json(row)
}

/** DELETE — remove one stored version by id (?id=). Never removes the last
 *  GLOBAL version, so the resolver always has a base to fall back to. */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await prisma.businessPeriodVersion.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.scope === 'GLOBAL') {
    const globalCount = await prisma.businessPeriodVersion.count({ where: { scope: 'GLOBAL' } })
    if (globalCount <= 1) return NextResponse.json({ error: 'The last Global version cannot be removed — edit it instead' }, { status: 409 })
  }

  await deleteBusinessPeriodVersion(id)
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'BusinessPeriodVersion', entityId: id, details: `Removed ${existing.scope}${existing.scopeId ? `:${existing.scopeId}` : ''} period version effective ${existing.effectiveDate.toISOString().slice(0, 10)}` },
  })
  return NextResponse.json({ ok: true })
}
