import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startOfDay, endOfDay } from 'date-fns'

const STAFF_SELECT = { id: true, name: true, position: true, outlet: { select: { id: true, name: true } } } as const

/**
 * GET /api/auth/pin-login/staff?outletId=... — public (pre-login). Feeds the
 * MyPOS staff picker grid (step 2, after an outlet has been chosen). Returns
 * only what's needed to render a tappable tile — never the pin hash or email.
 *
 * Events-only outlets (e.g. "Tips Events") have no permanent staff — instead
 * this surfaces whoever is EventStaff-assigned to a PLANNED/CONFIRMED event
 * happening today, regardless of their permanent home outlet. Their card
 * still shows their home outlet (via the `outlet` relation) so it's clear
 * who they normally work for.
 */
export async function GET(req: NextRequest) {
  const outletId = new URL(req.url).searchParams.get('outletId')
  if (!outletId) return NextResponse.json([])

  const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { isEventsOnly: true } })

  if (outlet?.isEventsOnly) {
    const today = new Date()
    const events = await prisma.event.findMany({
      where: { date: { gte: startOfDay(today), lte: endOfDay(today) }, status: { in: ['PLANNED', 'CONFIRMED'] } },
      select: { id: true },
    })
    if (events.length === 0) return NextResponse.json([])

    const assignments = await prisma.eventStaff.findMany({
      where: { eventId: { in: events.map((e) => e.id) } },
      select: { staffId: true },
    })
    const staffIds = [...new Set(assignments.map((a) => a.staffId))]
    if (staffIds.length === 0) return NextResponse.json([])

    const staff = await prisma.user.findMany({
      where: { id: { in: staffIds }, role: 'WAITER', isActive: true, pin: { not: null } },
      select: STAFF_SELECT,
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(staff)
  }

  const staff = await prisma.user.findMany({
    where: { role: 'WAITER', isActive: true, pin: { not: null }, outletId },
    select: STAFF_SELECT,
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(staff)
}
