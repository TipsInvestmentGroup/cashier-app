import { NextRequest, NextResponse } from 'next/server'
import { prismaSystem as prisma } from '@/lib/prisma'
import { limitEveryRequest } from '@/lib/rate-limit'

/**
 * GET /api/auth/pin-login/outlets — public (pre-login). Feeds the MyPOS
 * outlet picker (step 1 of staff sign-in) — just enough to render a tappable
 * outlet tile, never anything sensitive.
 */
export async function GET(req: NextRequest) {
  const limited = limitEveryRequest(req, 'pin-outlets', { limit: 120, windowMs: 60 * 1000 })
  if (limited) return limited

  const outlets = await prisma.outlet.findMany({
    where: { isActive: true },
    select: { id: true, name: true, isEventsOnly: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(outlets)
}
