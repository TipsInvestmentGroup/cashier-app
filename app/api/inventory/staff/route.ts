import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MANAGEMENT_ROLES } from '@/lib/shared-constants'

/**
 * GET /api/inventory/staff?outletId=
 * Staff picker for loss attribution. Separate from GET /api/users (gated
 * ADMIN/MANAGER only, excludes DIRECTOR) since every other inventory route
 * is consistently MANAGEMENT_ROLES-gated.
 */
export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!requireRole(payload, MANAGEMENT_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outletId = req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'outletId required' }, { status: 400 })

  const staff = await prisma.user.findMany({
    where: { outletId, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({ staff })
}
