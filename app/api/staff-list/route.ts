import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/** Minimal staff picker (id + name only) for any authenticated user — used by
 *  Cash Reconciliation's "Staff Tip" excess-amount field. Unlike /api/users
 *  (admin/manager-only, full records), this is safe for cashiers to call. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const staff = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(staff)
}
