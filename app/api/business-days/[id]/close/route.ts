import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveResourcePermission, BUSINESS_DAY_RESOURCES } from '@/lib/rbac'
import { closeBusinessDay } from '@/lib/business-day'

/** POST — close a Business Day by id (management page convenience wrapper around close-day). Body: { allowIncomplete? }. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await resolveResourcePermission(user, BUSINESS_DAY_RESOURCES.CLOSE_BUSINESS_DAY))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const bd = await prisma.businessDay.findUnique({ where: { id } })
  if (!bd) return NextResponse.json({ error: 'Business day not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const actor = { userId: user.userId, userName: user.name || user.email || 'Unknown' }
  const result = await closeBusinessDay({ outletId: bd.outletId, date: bd.date, actor, allowIncomplete: !!body.allowIncomplete })

  if (result.blocked) {
    return NextResponse.json({ error: 'Day cannot be closed — missing data', missingItems: result.missingItems }, { status: 400 })
  }
  return NextResponse.json({ ok: true, businessDay: result.businessDay })
}
