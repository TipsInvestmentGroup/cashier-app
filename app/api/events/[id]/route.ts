import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, requireRole } from '@/lib/auth'
import { SCHEDULE_MANAGE_ROLES, EVENT_STATUSES } from '@/lib/scheduling'
import { roundMoney } from '@/lib/utils'
import { parse, isValid, startOfDay } from 'date-fns'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/** GET /api/events/[id] — full event detail + financials report. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const event = await db.event.findUnique({
    where: { id },
    include: {
      outlet: { select: { id: true, name: true } },
      staff: { orderBy: { staffName: 'asc' } },
      expenses: { orderBy: { createdAt: 'asc' } },
      sponsors: { orderBy: { createdAt: 'asc' } },
      products: { orderBy: { createdAt: 'asc' }, include: { product: { select: { category: true, sellingPrice: true, unitMeasure: true } } } },
      targets: { orderBy: { createdAt: 'asc' } },
      ticketTypes: { orderBy: { createdAt: 'asc' } },
      tickets: { orderBy: { createdAt: 'desc' } },
      tables: { orderBy: { createdAt: 'asc' } },
      tableBookings: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  // Once an event has real POS sales, those become the source of truth for
  // "Event Sales" — the manual field stays as a fallback for events that
  // never touch the event POS, and is left untouched in the response so the
  // UI can tell the two apart.
  const closedOrders = await prisma.posOrder.findMany({ where: { eventId: id, status: 'CLOSED' }, select: { totalAmount: true } })
  const posOrderCount = closedOrders.length
  const posSalesTotal = roundMoney(closedOrders.reduce((s: number, o: { totalAmount: number }) => s + (o.totalAmount || 0), 0))
  const manualSalesTotal = roundMoney(event.salesTotal || 0)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalActual = roundMoney(event.expenses.reduce((s: number, x: any) => s + (x.amount || 0), 0))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalEstimated = roundMoney(event.expenses.reduce((s: number, x: any) => s + (x.estimatedCost || 0), 0))
  const budgetVariance = roundMoney(totalEstimated - totalActual)
  const salesTotal = posOrderCount > 0 ? posSalesTotal : manualSalesTotal
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sponsorshipTotal = roundMoney(event.sponsors.reduce((s: number, x: any) => s + (x.sponsorshipValue || 0), 0))
  const grossRevenue = roundMoney(salesTotal + sponsorshipTotal)
  const profit = roundMoney(grossRevenue - totalActual)
  const margin = grossRevenue > 0 ? Math.round((profit / grossRevenue) * 100) : 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attended = event.staff.filter((s: any) => s.attended).length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const staffSales = roundMoney(event.staff.reduce((s: number, x: any) => s + (x.salesAttributed || 0), 0))

  // Target vs actual — achievement %, shortage/surplus computed server-side.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const targets = event.targets.map((t: any) => {
    const achievementPct = t.targetValue > 0 ? Math.round((t.actualValue / t.targetValue) * 100) : 0
    const diff = roundMoney(t.actualValue - t.targetValue)
    return { ...t, achievementPct, shortage: diff < 0 ? roundMoney(-diff) : 0, surplus: diff > 0 ? diff : 0 }
  })

  // Ticket report — sold/remaining/revenue/checked-in/no-shows. `remaining`
  // is null (unlimited) if any ticket type has no cap; the caller can't sum
  // a finite remaining across a mix of capped and uncapped types.
  const activeTickets = event.tickets.filter((t: { bookingStatus: string }) => t.bookingStatus !== 'CANCELLED')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticketsSold = activeTickets.reduce((s: number, t: any) => s + (t.quantity || 0), 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticketsRevenue = roundMoney(activeTickets.reduce((s: number, t: any) => s + (t.totalAmount || 0), 0))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticketsCheckedIn = activeTickets.filter((t: any) => t.checkedIn).length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticketsNoShows = activeTickets.filter((t: any) => t.bookingStatus === 'CONFIRMED' && !t.checkedIn).length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasUncappedType = event.ticketTypes.some((tt: any) => tt.quantityAvailable == null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ticketsRemaining = hasUncappedType ? null : event.ticketTypes.reduce((sum: number, tt: any) => {
    const soldForType = activeTickets.filter((t: { ticketTypeId: string }) => t.ticketTypeId === tt.id).reduce((s: number, t: { quantity: number }) => s + (t.quantity || 0), 0)
    return sum + Math.max(0, (tt.quantityAvailable || 0) - soldForType)
  }, 0)

  // Table report — availability counts + deposit/balance rollup.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tablesAvailable = event.tables.filter((t: any) => t.status === 'AVAILABLE').length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tablesReserved = event.tables.filter((t: any) => t.status === 'RESERVED').length
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tablesOccupied = event.tables.filter((t: any) => t.status === 'OCCUPIED').length
  const activeTableBookings = event.tableBookings.filter((b: { bookingStatus: string }) => b.bookingStatus !== 'CANCELLED')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalDeposits = roundMoney(activeTableBookings.reduce((s: number, b: any) => s + (b.depositPaid || 0), 0))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const totalBalance = roundMoney(activeTableBookings.reduce((s: number, b: any) => s + ((b.totalAmount || 0) - (b.depositPaid || 0)), 0))

  // Active staff available to assign (for the picker).
  const allStaff = await prisma.user.findMany({
    where: { isActive: true }, select: { id: true, name: true, role: true, isCasual: true }, orderBy: { name: 'asc' },
  })
  // Active catalog products available to authorize (for the picker).
  const allProducts = await prisma.product.findMany({
    where: { isActive: true }, select: { id: true, name: true, category: true, sellingPrice: true, unitMeasure: true }, orderBy: { name: 'asc' },
  })
  // Outlets available to (re)assign this event to — surfaced because the
  // event-scoped POS only offers this event to staff logged into the SAME
  // outlet, so which outlet an event belongs to needs to be visible/editable.
  const allOutlets = await prisma.outlet.findMany({
    where: { isActive: true }, select: { id: true, name: true, isEventsOnly: true }, orderBy: { name: 'asc' },
  })

  return NextResponse.json({
    ...event,
    targets,
    allStaff,
    allProducts,
    allOutlets,
    report: {
      salesTotal, manualSalesTotal, posSalesTotal, posOrderCount, sponsorshipTotal, grossRevenue, totalExpenses: totalActual, profit, margin,
      staffCount: event.staff.length, attended, staffSales,
      budget: { totalEstimated, totalActual, variance: budgetVariance },
      tickets: { sold: ticketsSold, remaining: ticketsRemaining, revenue: ticketsRevenue, checkedIn: ticketsCheckedIn, noShows: ticketsNoShows },
      tables: { available: tablesAvailable, reserved: tablesReserved, occupied: tablesOccupied, totalDeposits, totalBalance },
    },
  })
}

/** PATCH /api/events/[id] — update event fields, status, or sales total. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await db.event.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.description !== undefined) data.description = body.description?.trim() || null
  if (body.eventType !== undefined) data.eventType = body.eventType?.trim() || null
  if (body.clientName !== undefined) data.clientName = body.clientName?.trim() || null
  if (body.location !== undefined) data.location = body.location?.trim() || null
  if (body.startTime !== undefined) data.startTime = body.startTime || null
  if (body.endTime !== undefined) data.endTime = body.endTime || null
  if (body.notes !== undefined) data.notes = body.notes?.trim() || null
  if (body.outletId !== undefined) data.outletId = body.outletId || null
  if (body.expectedGuests !== undefined) data.expectedGuests = Math.max(0, Math.round(Number(body.expectedGuests) || 0))
  if (body.salesTotal !== undefined) data.salesTotal = roundMoney(Number(body.salesTotal) || 0)
  if (body.status !== undefined) {
    if (!EVENT_STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    data.status = body.status
  }
  if (body.date !== undefined) {
    const p = parse(body.date, 'yyyy-MM-dd', new Date())
    if (!isValid(p)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    data.date = startOfDay(p)
  }

  const event = await db.event.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'Event', entityId: id, details: `Updated event "${event.name}"` },
  })
  return NextResponse.json(event)
}

/** DELETE /api/events/[id] — remove an event (cascades staff & expenses). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, SCHEDULE_MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await db.event.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

  await db.event.delete({ where: { id } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'Event', entityId: id, details: `Deleted event "${existing.name}"` },
  })
  return NextResponse.json({ ok: true })
}
