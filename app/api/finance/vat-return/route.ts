import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { canViewFinance } from '@/lib/finance-access'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { vatReturn } from '@/lib/vat'

/** GET ?from=&to= — VAT return for a period: output − input = net payable. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canViewFinance(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const companyId = searchParams.get('companyId') || (await resolveDefaultCompanyId(prisma))
  if (!companyId) return NextResponse.json({ error: 'No company' }, { status: 400 })

  // Default to the current calendar month if no window is given.
  const now = new Date()
  const from = searchParams.get('from') ? new Date(searchParams.get('from')!) : new Date(now.getFullYear(), now.getMonth(), 1)
  const to = searchParams.get('to') ? new Date(searchParams.get('to')!) : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  return NextResponse.json(await vatReturn(prisma, companyId, from, to))
}
