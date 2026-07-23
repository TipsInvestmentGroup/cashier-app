import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'

// Candidates for linking a new employee: users and persons NOT already attached
// to an Employee (both links are unique). Persons can be many, so they're
// name-searchable and capped; users are the finite login roster.
const ALLOWED_ROLES = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, ALLOWED_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()

  const linked = await prisma.employee.findMany({ select: { userId: true, personId: true } })
  const linkedUserIds = linked.map((e) => e.userId).filter((id): id is string => !!id)
  const linkedPersonIds = linked.map((e) => e.personId).filter((id): id is string => !!id)

  const [users, persons] = await Promise.all([
    prisma.user.findMany({
      where: { id: { notIn: linkedUserIds }, ...(q ? { name: { contains: q } } : {}) },
      select: { id: true, name: true, email: true, role: true, outletId: true },
      orderBy: { name: 'asc' },
      take: 200,
    }),
    prisma.person.findMany({
      where: { id: { notIn: linkedPersonIds }, ...(q ? { name: { contains: q } } : {}) },
      select: { id: true, name: true, phone: true, code: true },
      orderBy: { name: 'asc' },
      take: 50,
    }),
  ])

  return NextResponse.json({ users, persons })
}
