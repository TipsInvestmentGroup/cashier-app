import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { resolveCollectionMode } from '@/lib/collection-mode'

/**
 * GET — the effective Collection Mode for the caller: their own role +
 * outlet, unless ?outletId=/&role= is passed (ADMIN preview use, e.g. the
 * Collection Mode Settings page showing "what would apply here"). Any
 * authenticated user may call this — it's read-only and just says which
 * screens to show, not sensitive data.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = searchParams.get('outletId') ?? user.outletId ?? null
  const role = searchParams.get('role') ?? user.role

  const mode = await resolveCollectionMode({ outletId, role })
  return NextResponse.json({ mode })
}
