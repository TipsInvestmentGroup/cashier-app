import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { hasPermission, RESOURCES } from '@/lib/rbac'
import { usersWithGrant, isGrantType, GRANT_TYPES } from '@/lib/expense-grants'
import { isFundClass } from '@/lib/expense-funds'

/**
 * GET — the users holding a given grant for a fund/outlet. §4 makes the access
 * list the single source of truth for "who can be assigned as a custodian", so
 * the custodian picker reads this rather than filtering User.role, which would
 * offer people the access list has not actually authorized.
 *
 * Access is split rather than blanket-widened, because the response carries
 * names and emails and the approval structure is more sensitive than the
 * requester list:
 *   • ADMIN (or a COLLECTION_APPROVALS grant holder) may query any grant type —
 *     the Setup screens need CUSTODIAN, and approvals tooling needs the rest.
 *   • Everyone else who can reach the Expense Form may query REQUEST only, to
 *     populate its "Requested By" dropdown (§4: the access list is what decides
 *     who appears there). They get no view of who approves what.
 *
 *   ?grantType=CUSTODIAN&fundClass=PETTY_CASH&outletId=<id>
 */
const FORM_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const grantType = searchParams.get('grantType') || ''
  if (!isGrantType(grantType)) {
    return NextResponse.json({ error: `grantType must be one of ${GRANT_TYPES.join(', ')}` }, { status: 400 })
  }

  const seesAll = user.role === 'ADMIN' || (await hasPermission(user.email, user.userId, RESOURCES.COLLECTION_APPROVALS, 'edit'))
  if (!seesAll) {
    if (!FORM_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (grantType !== 'REQUEST') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
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
