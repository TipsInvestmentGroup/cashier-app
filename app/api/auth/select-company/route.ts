import { NextRequest, NextResponse } from 'next/server'
import { prismaSystem as prisma } from '@/lib/prisma'
import { verifyKindToken } from '@/lib/auth'
import { ensureMemberships, issueSession, pickMembership, usableMemberships } from '@/lib/tenant'
import { ownerEmail } from '@/lib/owner'
import { limitEveryRequest } from '@/lib/rate-limit'

/**
 * POST /api/auth/select-company — body: { selectToken, company }
 * Second step of sign-in for a user who belongs to more than one company: exchanges the short-lived
 * selection token (issued by /api/auth/login after the password was verified) for a session token bound
 * to the chosen company. The selection token is not a session and is useless anywhere else.
 */
export async function POST(req: NextRequest) {
  const limited = limitEveryRequest(req, 'select-company', { limit: 30, windowMs: 10 * 60 * 1000 })
  if (limited) return limited

  const { selectToken, company } = await req.json().catch(() => ({}))
  const claims = selectToken ? verifyKindToken<{ userId: string; sepoch?: number }>(String(selectToken), 'select') : null
  if (!claims || !company) return NextResponse.json({ error: 'Your sign-in expired. Please sign in again.' }, { status: 401 })

  const user = await prisma.user.findUnique({ where: { id: claims.userId } })
  if (!user || !user.isActive || (typeof claims.sepoch === 'number' && claims.sepoch !== user.sessionEpoch)) {
    return NextResponse.json({ error: 'Your sign-in expired. Please sign in again.' }, { status: 401 })
  }

  const chosen = pickMembership(usableMemberships(await ensureMemberships(prisma, user)), company)
  if (!chosen) return NextResponse.json({ error: 'You do not have access to that company.' }, { status: 403 })

  const outlet = chosen.outletId ? await prisma.outlet.findUnique({ where: { id: chosen.outletId } }) : null
  const session = issueSession(user, chosen, outlet)
  return NextResponse.json({ ...session, user: { ...session.user, ownerEmail: ownerEmail() } })
}
