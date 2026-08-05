import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { usersWithGrant, isGrantType, GRANT_TYPES } from '@/lib/expense-grants'
import { isFundClass } from '@/lib/expense-funds'

/**
 * GET — the users holding a given grant for a fund/outlet. §4 makes the access
 * list the single source of truth for "who can be assigned as a custodian", so
 * the custodian picker reads this rather than filtering User.role, which would
 * offer people the access list has not actually authorized.
 *
 * ADMIN-only for now because its only caller is the Setup screen. Phase 4's
 * Expense Form needs the same primitive for its "Requested By" dropdown
 * (grantType=REQUEST) and will have to widen this — deliberately not widened
 * ahead of a caller, since the response carries names and emails.
 *
 *   ?grantType=CUSTODIAN&fundClass=PETTY_CASH&outletId=<id>
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const grantType = searchParams.get('grantType') || ''
  if (!isGrantType(grantType)) {
    return NextResponse.json({ error: `grantType must be one of ${GRANT_TYPES.join(', ')}` }, { status: 400 })
  }

  const rawFundClass = searchParams.get('fundClass')
  if (rawFundClass && !isFundClass(rawFundClass)) {
    return NextResponse.json({ error: `Unknown fund: ${rawFundClass}` }, { status: 400 })
  }

  const users = await usersWithGrant(grantType, {
    fundClass: rawFundClass && isFundClass(rawFundClass) ? rawFundClass : null,
    outletId: searchParams.get('outletId') || null,
  })
  return NextResponse.json(users)
}
