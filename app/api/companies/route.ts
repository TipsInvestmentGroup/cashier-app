import { NextRequest, NextResponse } from 'next/server'
import { prismaSystem as prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

/** GET — list companies (ADMIN-only; today's Setup screens are the only consumer). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Only companies THIS login belongs to - never the whole directory (that is the platform console's job).
  const companies = await prisma.company.findMany({ where: { memberships: { some: { userId: user.userId, isActive: true } } }, orderBy: { name: 'asc' } })
  return NextResponse.json(companies)
}
