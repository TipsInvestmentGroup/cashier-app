import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { computeActuals } from '@/lib/target-actuals'
import { parse, isValid } from 'date-fns'

/** Net actuals for target tracking over a window. Cashier-scoped. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const from = parseD(searchParams.get('from')) || new Date()
  const to = parseD(searchParams.get('to')) || from

  return NextResponse.json(await computeActuals({ from, to, outletId }))
}
