import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { getCompanyConfig, updateCompanyConfig } from '@/lib/company-config'

/**
 * Company preferences (branding, currency, VAT). GET is unauthenticated by
 * design — the login/staff-login screens render branding before any session
 * exists, and nothing here is sensitive. PUT is Admin-only.
 */
export async function GET() {
  return NextResponse.json(await getCompanyConfig())
}

export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Only an Admin can change company preferences' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const next = await updateCompanyConfig(body || {})
  return NextResponse.json(next)
}
