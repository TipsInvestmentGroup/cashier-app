import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { isOwner, getCashVerifierEmail, setCashVerifierEmail, canVerifyCash, CASH_VERIFIERS_FIXED } from '@/lib/cash-verify'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()

/** Who can enter "cash verified": owner + two fixed officers + owner-chosen one. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const verifierEmail = await getCashVerifierEmail()
  return NextResponse.json({
    owner: OWNER_EMAIL,
    fixed: CASH_VERIFIERS_FIXED,
    verifierEmail,
    isOwner: isOwner(user.email),
    canVerify: await canVerifyCash(user.email),
  })
}

/** Owner sets/changes the extra verifier. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isOwner(user.email)) return NextResponse.json({ error: 'Only the system owner can change verifier access' }, { status: 403 })

  const { email } = await req.json().catch(() => ({}))
  await setCashVerifierEmail((email || '').toLowerCase())
  return NextResponse.json({ ok: true, verifierEmail: (email || '').toLowerCase() })
}
