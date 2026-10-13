import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireActiveUser } from '@/lib/auth'
import { isOwnerEmail, ownerEmail } from '@/lib/owner'

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
    select: { id: true, name: true, email: true, role: true, position: true, outlet: true },
  })
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({
    user: { ...user, isOwner: isOwnerEmail(user.email), ownerEmail: ownerEmail() },
  })
}
