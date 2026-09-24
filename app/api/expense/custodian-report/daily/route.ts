import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, CASHIER_ROLES, NO_OUTLET } from '@/lib/auth'
import { buildDailyCustodianMovement } from '@/lib/custodian-report'
import { parse, isValid } from 'date-fns'

/**
 * Daily Custodian Movement Report (Spec v2 §7 / §9.2) — a single-day snapshot:
 * the Custodian Report numbers for the day plus a compact transaction list.
 * Same auth posture as the range report. ?date=yyyy-MM-dd (defaults to today).
 * Sending is done by the client via the existing /api/email-report ("Email
 * Directors") mechanism — no separate send endpoint, so the DIRECTOR
 * distribution list stays a single source of truth.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CASHIER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  if (outletId === NO_OUTLET) {
    return NextResponse.json({ date: new Date(), report: { rows: [], byFundClass: [], combined: { opening: 0, debited: 0, spent: 0, closing: 0 }, flaggedCount: 0 }, transactions: [], outlets: [] })
  }

  const dParam = searchParams.get('date')
  const parsed = dParam ? parse(dParam, 'yyyy-MM-dd', new Date()) : new Date()
  const date = isValid(parsed) ? parsed : new Date()

  const daily = await buildDailyCustodianMovement(date, outletId)

  const outlets = readOutletScope(user, null) === null
    ? await prisma.outlet.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : await prisma.outlet.findMany({ where: { id: outletId ?? undefined }, select: { id: true, name: true } })

  return NextResponse.json({ ...daily, outlets })
}
