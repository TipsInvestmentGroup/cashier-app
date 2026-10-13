import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireActiveUser } from '@/lib/auth'
import { ensureMemberships, issueSession, pickMembership, usableMemberships } from '@/lib/tenant'
import { ownerEmail } from '@/lib/owner'

/**
 * POST /api/auth/switch-company — body: { company }   (company = id or code)
 * A signed-in user who belongs to several companies moves to another one. Returns a NEW session token
 * bound to that company; the old token keeps working for its own company until it expires (it is still a
 * valid session there). Re-validated against the database, so a suspended company or a removed
 * membership cannot be switched into. The client must discard every cached/queued record of the
 * previous company when it adopts the new token.
 */
export async function POST(req: NextRequest) {
  const auth = await requireActiveUser(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company } = await req.json().catch(() => ({}))
  if (!company) return NextResponse.json({ error: 'company is required' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: auth.userId } })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const chosen = pickMembership(usableMemberships(await ensureMemberships(prisma, user)), company)
  if (!chosen) return NextResponse.json({ error: 'You do not have access to that company.' }, { status: 403 })

  const outlet = chosen.outletId ? await prisma.outlet.findUnique({ where: { id: chosen.outletId } }) : null
  const session = issueSession(user, chosen, outlet)
  await prisma.auditLog.create({
    data: { userId: user.id, action: 'SWITCH_COMPANY', entity: 'Company', entityId: chosen.companyId, details: `Switched to ${chosen.company.name}` },
  })
  return NextResponse.json({ ...session, user: { ...session.user, ownerEmail: ownerEmail() } })
}
