import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/auth/pin-login/staff — public (pre-login). Feeds the MyPOS staff
 * picker grid. Returns only what's needed to render a tappable tile — never
 * the pin hash or email.
 */
export async function GET() {
  const staff = await prisma.user.findMany({
    where: { role: 'WAITER', isActive: true, pin: { not: null } },
    select: { id: true, name: true, position: true, outlet: { select: { id: true, name: true } } },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(staff)
}
