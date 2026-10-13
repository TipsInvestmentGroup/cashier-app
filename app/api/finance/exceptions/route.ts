import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance } from '@/lib/finance-access'
import { tenantCompanyId } from '@/lib/tenant'
import { scanExceptions } from '@/lib/finance-exceptions'

/** Live data-validation scan — see lib/finance-exceptions.ts for exactly
 *  what's checked (this is not exhaustive; extending the checklist means
 *  adding a checker there, not here). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = await tenantCompanyId(user, searchParams.get('companyId'))
  if (!companyId) return NextResponse.json([])

  const exceptions = await scanExceptions(companyId)
  return NextResponse.json(exceptions)
}
