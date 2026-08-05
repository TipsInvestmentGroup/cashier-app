import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { grantAccess, listGrants, isGrantType, validateGrantShape, RESERVED_GRANT_TYPES, GRANT_TYPES } from '@/lib/expense-grants'

/** GET — the Manage Access table (§4). ADMIN only: the list names who can move
 *  money and who signs it off, so it is not visibility for the disbursers
 *  themselves. A non-admin who needs to know their OWN access reads it through
 *  the screens that gate on it, not from this list. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const companyId = await resolveDefaultCompanyId(prisma)
  if (!companyId) return NextResponse.json({ error: 'No company configured' }, { status: 400 })

  const includeRevoked = req.nextUrl.searchParams.get('includeRevoked') === 'true'
  const grants = await listGrants(companyId, { includeRevoked })
  return NextResponse.json(grants)
}

/**
 * POST — grant access. Accepts a single { userId, grantType, fundClass,
 * outletId } or a batch { userId, outletId, flags: [{grantType, fundClass}] }
 * so the UI's "add a user and tick the boxes" flow is one request rather than
 * six, and a partially-applied set of flags can't result from a dropped
 * connection midway through.
 */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const companyId = await resolveDefaultCompanyId(prisma)
  if (!companyId) return NextResponse.json({ error: 'No company configured' }, { status: 400 })

  const body = await req.json().catch(() => ({}))

  // Resolve the target user by id or by email — §4 specifies adding users by
  // email, but the UI already has the user list, so accept either.
  let targetUserId = body.userId ? String(body.userId) : ''
  if (!targetUserId && body.email) {
    const found = await prisma.user.findFirst({ where: { email: String(body.email).trim().toLowerCase() }, select: { id: true } })
    if (!found) return NextResponse.json({ error: `No user with email ${body.email}` }, { status: 404 })
    targetUserId = found.id
  }
  if (!targetUserId) return NextResponse.json({ error: 'userId or email is required' }, { status: 400 })

  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, name: true, isActive: true } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  if (!target.isActive) return NextResponse.json({ error: `${target.name} is deactivated — reactivate the account before granting access` }, { status: 400 })

  const outletId = body.outletId ? String(body.outletId) : null
  if (outletId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { id: true } })
    if (!outlet) return NextResponse.json({ error: 'outletId does not reference a known outlet' }, { status: 400 })
  }

  // Normalize single-grant and batch shapes into one list.
  const rawFlags: { grantType: unknown; fundClass?: unknown }[] = Array.isArray(body.flags)
    ? body.flags
    : [{ grantType: body.grantType, fundClass: body.fundClass }]
  if (!rawFlags.length) return NextResponse.json({ error: 'At least one grant is required' }, { status: 400 })

  const flags: { grantType: (typeof GRANT_TYPES)[number]; fundClass: string | null }[] = []
  for (const raw of rawFlags) {
    const grantType = raw.grantType === undefined || raw.grantType === null ? '' : String(raw.grantType)
    if (!isGrantType(grantType)) {
      return NextResponse.json({ error: `grantType must be one of ${GRANT_TYPES.join(', ')}` }, { status: 400 })
    }
    if (RESERVED_GRANT_TYPES.includes(grantType)) {
      return NextResponse.json({ error: `${grantType} is reserved and cannot be granted — the Second Approver executes allocations` }, { status: 400 })
    }
    const fundClass = raw.fundClass === undefined || raw.fundClass === null || raw.fundClass === '' ? null : String(raw.fundClass)
    const shapeError = validateGrantShape(grantType, fundClass)
    if (shapeError) return NextResponse.json({ error: shapeError }, { status: 400 })
    flags.push({ grantType, fundClass })
  }

  const created = []
  for (const flag of flags) {
    created.push(await grantAccess({
      companyId,
      userId: targetUserId,
      grantType: flag.grantType,
      fundClass: flag.fundClass,
      outletId,
      grantedById: user.userId,
      grantedByName: user.name,
      note: body.note ? String(body.note) : null,
    }))
  }

  await prisma.auditLog.create({
    data: {
      userId: user.userId, action: 'CREATE', entity: 'ExpenseAccessGrant', entityId: created[0]?.id || null,
      details: `Granted ${flags.map((f) => `${f.grantType}${f.fundClass ? `:${f.fundClass}` : ''}`).join(', ')} to ${target.name}${outletId ? '' : ' (all outlets)'}`,
    },
  })
  return NextResponse.json(created, { status: 201 })
}
