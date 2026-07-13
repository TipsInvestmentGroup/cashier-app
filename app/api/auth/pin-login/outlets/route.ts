import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/auth/pin-login/outlets — public (pre-login). Feeds the MyPOS
 * outlet picker (step 1 of staff sign-in) — just enough to render a tappable
 * outlet tile, never anything sensitive.
 */
export async function GET() {
  const outlets = await prisma.outlet.findMany({
    where: { isActive: true },
    select: { id: true, name: true, isEventsOnly: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(outlets)
}
