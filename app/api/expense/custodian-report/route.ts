import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, readOutletScope, CASHIER_ROLES, NO_OUTLET } from '@/lib/auth'
import { buildCustodianReport } from '@/lib/custodian-report'
import { isFundClass } from '@/lib/expense-funds'
import { startOfDay, endOfDay, parse, isValid } from 'date-fns'

/**
 * Custodian Report (Spec v2 §1–§6) — the cross-fund, custodian-accountability
 * view. Same auth posture as app/api/expense/report/route.ts: CASHIER_ROLES may
 * read, and readOutletScope hard-locks a single-outlet CASHIER to their own
 * outlet (a director/manager may pass ?outletId= or omit it for all outlets).
 *
 * Query params: from, to (yyyy-MM-dd), outletId, fundClass
 * (CASHIER_CASH|PETTY_CASH|DIGITAL). All optional; defaults to a single day = to.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!CASHIER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  // A single-outlet role with no outlet resolves to NO_OUTLET — return an empty
  // report rather than silently widening to every outlet.
  if (outletId === NO_OUTLET) {
    return NextResponse.json({ from: new Date(), to: new Date(), rows: [], byFundClass: [], combined: { opening: 0, debited: 0, spent: 0, closing: 0 }, flaggedCount: 0, outlets: [] })
  }

  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const to = parseD(searchParams.get('to')) || new Date()
  const from = parseD(searchParams.get('from')) || to

  const fundClassParam = searchParams.get('fundClass')
  const fundClass = isFundClass(fundClassParam) ? fundClassParam : null

  const report = await buildCustodianReport({
    from: startOfDay(from),
    to: endOfDay(to),
    outletId,
    fundClass,
  })

  // Outlet list for the filter dropdown — a single-outlet role only ever sees
  // its own, everyone else sees all. Sent with the report so the client needs
  // one request, not two.
  const outlets = readOutletScope(user, null) === null
    ? await prisma.outlet.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
    : await prisma.outlet.findMany({ where: { id: outletId ?? undefined }, select: { id: true, name: true } })

  return NextResponse.json({ ...report, outlets })
}
