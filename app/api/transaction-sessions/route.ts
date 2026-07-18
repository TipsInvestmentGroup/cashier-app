import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, writeOutletId } from '@/lib/auth'
import { resolveCollectionMode } from '@/lib/collection-mode'
import { startOfDay, endOfDay } from 'date-fns'

const CASHIER_ROLES = ['CASHIER', 'ACCOUNTANT', 'ADMIN']

/** GET — list Transaction Sessions. ?outletId=&from=&to= (cashiers locked to their own outlet). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const where: Record<string, unknown> = {}
  if (outletId) where.outletId = outletId
  if (from && to) where.date = { gte: startOfDay(new Date(from)), lte: endOfDay(new Date(to)) }

  const sessions = await prisma.transactionSession.findMany({
    where,
    include: {
      outlet: { select: { name: true } },
      _count: { select: { systemSales: true, transactions: true } },
    },
    orderBy: { date: 'desc' },
    take: 100,
  })
  return NextResponse.json(sessions)
}

/** POST — open (get-or-create) today's session for an outlet+date. Body: { date, outletId? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CASHIER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const outletId = writeOutletId(user, body.outletId)
  if (!outletId) return NextResponse.json({ error: 'Outlet required' }, { status: 400 })
  const date = body.date ? startOfDay(new Date(body.date)) : startOfDay(new Date())
  if (isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

  // This outlet may be configured for Default (fixed-form) Collection only
  // — the Collection Mode Engine decides, not this route. Block opening a
  // Transaction Session there rather than silently letting two workflows run
  // in parallel for the same outlet/day. HYBRID explicitly allows both
  // workflows at once (e.g. some staff self-declare while the cashier still
  // enters others directly), so it passes this gate too.
  const mode = await resolveCollectionMode({ outletId })
  if (mode !== 'TRANSACTION_VERIFICATION' && mode !== 'HYBRID') {
    return NextResponse.json({ error: 'This outlet is configured for Default Collection Mode — use Daily Collections instead. Ask an Admin to change it under Setup → Collection Mode if this is wrong.' }, { status: 409 })
  }

  const session = await prisma.transactionSession.upsert({
    where: { outletId_date: { outletId, date } },
    update: {},
    create: { outletId, date, createdById: user.userId },
  })
  return NextResponse.json(session)
}
