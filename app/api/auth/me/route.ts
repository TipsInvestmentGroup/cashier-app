import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireActiveUser } from '@/lib/auth'
import { ownerEmail } from '@/lib/owner'
import { ensureMemberships, usableMemberships } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me — the caller's CURRENT identity, re-read from the database.
 *
 * Used by the client on load to (a) drop a session that has been revoked
 * (deactivated user, password reset, role/outlet change bumped sessionEpoch)
 * instead of waiting for the token to expire, and (b) learn whether the user
 * is the system owner without the owner's email being compiled into the public
 * JS bundle. The owner address is only ever returned to an authenticated user.
 */
export async function GET(req: NextRequest) {
  const auth = await requireActiveUser(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true, name: true, email: true, role: true, position: true, outletId: true, isActive: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // `auth` is already bound to the session's company (role/outlet/position come from that membership).
  const memberships = usableMemberships(await ensureMemberships(prisma, { ...user, outletId: user.outletId ?? null, position: user.position ?? null }))
  const active = memberships.find((m) => m.companyId === auth.companyId) ?? null
  const outlet = auth.outletId ? await prisma.outlet.findUnique({ where: { id: auth.outletId }, select: { id: true, name: true } }) : null

  return NextResponse.json({
    user: {
      id: user.id, name: user.name, email: user.email, role: auth.role, position: auth.position ?? null, outlet,
      company: active ? { id: active.company.id, name: active.company.name, slug: active.company.slug } : null,
      isOwner: !!auth.owner,
      ownerEmail: ownerEmail(),
    },
    // Companies this login can switch into (the picker shows only when there is more than one).
    companies: memberships.map((m) => ({ id: m.company.id, name: m.company.name, slug: m.company.slug, active: m.companyId === auth.companyId })),
  })
}
