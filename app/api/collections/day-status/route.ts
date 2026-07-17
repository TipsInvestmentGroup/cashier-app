import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'
import { getCollectionSessionTotals } from '@/lib/collection-session-totals'
import { resolveBusinessDate } from '@/lib/business-date'
import { getCompanyConfig } from '@/lib/company-config'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any

/**
 * Readiness of a day for closing: is Cash Reconciliation done, is Digital
 * Reconciliation done, and is the day already closed — for one outlet+date.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  if (!outletId) return NextResponse.json({ cashReconDone: false, digitalReconDone: false, closed: false })

  const p = parse(searchParams.get('date') || '', 'yyyy-MM-dd', new Date())
  const day = isValid(p) ? p : resolveBusinessDate(new Date(), (await getCompanyConfig()).businessDayCutoverHour)
  const range = { gte: startOfDay(day), lte: endOfDay(day) }

  const [cashRecon, digitalCount, closure, templateSessions] = await Promise.all([
    prisma.cashRecon.findFirst({ where: { outletId, date: range }, select: { id: true } }),
    prisma.bankRecon.count({ where: { outletId, date: range, channel: { not: null } } }),
    db.dayClosure.findUnique({ where: { outletId_date: { outletId, date: startOfDay(day) } }, select: { id: true } }),
    getCollectionSessionTotals({ outletId, dateRange: range }),
  ])

  return NextResponse.json({
    cashReconDone: !!cashRecon,
    digitalReconDone: digitalCount > 0,
    templateSessionsOpen: templateSessions.some((s) => s.hasOpenWork),
    closed: !!closure,
  })
}
