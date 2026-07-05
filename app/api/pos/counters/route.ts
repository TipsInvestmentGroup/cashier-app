import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/pos/counters?outletId= — the outlet's active counters, in a
 * stable display order. Outlets can have different physical setups (e.g.
 * Mikocheni's Main Bar + VIP + Shisha + Kitchen vs another outlet's
 * Main/Bar/Shisha/Kitchen), so counter lists must never be hardcoded
 * client-side — that broke the moment a second outlet's layout diverged.
 */
const ORDER: Record<string, number> = { MAIN: 0, VIP: 1, SHISHA: 2, KITCHEN: 3, BAR: 4 }

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const counters = await prisma.posCounter.findMany({
    where: { outletId, isActive: true },
    select: { code: true, label: true, serviceModel: true },
  })
  counters.sort((a, b) => (ORDER[a.code] ?? 99) - (ORDER[b.code] ?? 99))

  return NextResponse.json(counters)
}
