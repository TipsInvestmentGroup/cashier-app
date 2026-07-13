import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/auth/pin-login/staff?outletId=... — public (pre-login). Feeds the
 * MyPOS staff picker grid (step 2, after an outlet has been chosen). Returns
 * only what's needed to render a tappable tile — never the pin hash or email.
 */
export async function GET(req: NextRequest) {
  const outletId = new URL(req.url).searchParams.get('outletId')
  const staff = await prisma.user.findMany({
    where: { role: 'WAITER', isActive: true, pin: { not: null }, ...(outletId ? { outletId } : {}) },
    select: { id: true, name: true, position: true, outlet: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(staff)
}
