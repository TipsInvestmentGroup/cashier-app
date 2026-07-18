import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { setCollectionMode, COLLECTION_MODES, SCOPES, type Scope, type CollectionMode } from '@/lib/collection-mode'
import { VALID_ROLES } from '@/lib/shared-constants'

/** GET — list every configured override (ADMIN-only; Collection Mode Settings page). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await prisma.collectionModeConfig.findMany({ orderBy: [{ scope: 'asc' }, { scopeId: 'asc' }] })
  return NextResponse.json(rows)
}

/** POST — set (create or update) one scope's mode. Body: { scope, scopeId?, mode } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const scope = body.scope as Scope
  const scopeId = body.scopeId ? String(body.scopeId) : null
  const mode = body.mode as CollectionMode

  if (!SCOPES.includes(scope)) return NextResponse.json({ error: `scope must be one of ${SCOPES.join(', ')}` }, { status: 400 })
  if (!COLLECTION_MODES.includes(mode)) return NextResponse.json({ error: `mode must be one of ${COLLECTION_MODES.join(', ')}` }, { status: 400 })
  if (scope !== 'GLOBAL' && !scopeId) return NextResponse.json({ error: 'scopeId is required for a non-GLOBAL scope' }, { status: 400 })
  if (scope === 'ROLE' && !VALID_ROLES.includes(scopeId!)) return NextResponse.json({ error: 'scopeId must be a valid role' }, { status: 400 })
  if (scope === 'OUTLET' && !(await prisma.outlet.findUnique({ where: { id: scopeId! } }))) return NextResponse.json({ error: 'Outlet not found' }, { status: 404 })
  if (scope === 'COMPANY' && !(await prisma.company.findUnique({ where: { id: scopeId! } }))) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const row = await setCollectionMode(scope, scopeId, mode)

  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'CollectionModeConfig', entityId: row.id, details: `Set ${scope}${scopeId ? `:${scopeId}` : ''} → ${mode}` },
  })

  return NextResponse.json(row)
}

/** DELETE — remove an override (falls back to the next-widest scope). ?id= */
export async function DELETE(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const existing = await prisma.collectionModeConfig.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (existing.scope === 'GLOBAL') return NextResponse.json({ error: 'The Global Default cannot be removed — set it to a different mode instead' }, { status: 409 })

  await prisma.collectionModeConfig.delete({ where: { id } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'CollectionModeConfig', entityId: id, details: `Removed ${existing.scope}${existing.scopeId ? `:${existing.scopeId}` : ''} override` },
  })
  return NextResponse.json({ ok: true })
}
