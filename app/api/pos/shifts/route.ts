import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const outletId = payload.outletId ?? req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  // Waiter/tables flows only ever need "today's open shift" — default stays
  // that way. Reports (management-only, already role-gated by the caller)
  // need a historical shift picker, so ?all=true skips the today filter.
  const includeAll = req.nextUrl.searchParams.get('all') === 'true'
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const shifts = await prisma.posShift.findMany({
    where: { outletId, ...(includeAll ? {} : { date: { gte: todayStart } }) },
    orderBy: { openedAt: 'desc' },
    ...(includeAll ? { take: 200 } : {}),
  })
  return NextResponse.json(shifts)
}

export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const { name, outletId: bodyOutletId } = await req.json()
  const VALID_SHIFTS = ['MORNING', 'EVENING']
  if (!VALID_SHIFTS.includes(name)) return NextResponse.json({ error: 'Invalid shift name' }, { status: 400 })

  const outletId = payload.outletId ?? bodyOutletId
  if (!outletId) return NextResponse.json({ error: 'No outlet' }, { status: 400 })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const existing = await prisma.posShift.findFirst({
    where: { outletId, name, date: { gte: todayStart }, closedAt: null },
  })
  if (existing) return NextResponse.json(existing)

  const shift = await prisma.posShift.create({
    data: { outletId, name, date: new Date(), openedBy: payload.userId },
  })
  return NextResponse.json(shift, { status: 201 })
}
