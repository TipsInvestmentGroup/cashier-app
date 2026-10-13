import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Central session-revocation gate for the API.
 *
 * Until now only ~5 of ~350 API routes re-checked the database ("requireActiveUser"); the
 * rest trusted the signed token alone, so a deactivated, demoted or password-reset user kept
 * full access until their token expired (up to 8h). This runs in front of every /api request
 * and rejects a validly-signed session token whose account has since been deactivated or whose
 * `sessionEpoch` has moved on (role/outlet change, password/PIN reset, deactivation — see
 * revokeUserSessions). Individual routes need no change.
 *
 * Deliberately conservative — it can only ever DENY a request that carries a genuine session
 * token for a revoked account:
 *   - no Authorization header, or a Bearer value that is not one of our signed session tokens
 *     (cron/CI secrets, webhooks, public endpoints, login itself) -> passes through untouched;
 *     the route applies its own authentication exactly as before.
 *   - if the database cannot be reached, it FAILS OPEN (the route itself will then fail or
 *     succeed on its own merits) so a transient outage here can never lock the whole business out.
 *
 * Cost: one primary-key lookup per user per ~15s per warm instance (small in-memory cache), so a
 * revocation takes effect within ~15s rather than after the token's lifetime.
 */

interface CachedUser {
  isActive: boolean
  epoch: number
  /** undefined when the token carries no company claim (legacy token): membership is not checked. */
  membershipOk?: boolean
  companyStatus?: string
  at: number
}
const CACHE_TTL_MS = 15_000
const MAX_CACHE = 5_000
const cache = new Map<string, CachedUser>()

async function currentState(userId: string, companyId?: string): Promise<CachedUser | null> {
  const now = Date.now()
  const key = `${userId}:${companyId ?? ''}`
  const hit = cache.get(key)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit
  // One query: the account, plus (when the token is bound to a company) that membership and its company.
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isActive: true, sessionEpoch: true,
      ...(companyId ? { memberships: { where: { companyId }, select: { isActive: true, company: { select: { status: true } } } } } : {}),
    },
  })
  if (!u) return { isActive: false, epoch: -1, at: now } // user deleted -> revoked
  if (cache.size >= MAX_CACHE) cache.clear()
  const fresh: CachedUser = { isActive: u.isActive, epoch: u.sessionEpoch, at: now }
  if (companyId) {
    const m = (u as unknown as { memberships?: { isActive: boolean; company: { status: string } }[] }).memberships?.[0]
    fresh.membershipOk = !!m && m.isActive
    fresh.companyStatus = m?.company.status
  }
  cache.set(key, fresh)
  return fresh
}

export async function proxy(req: NextRequest) {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return NextResponse.next()

  const claims = verifyToken(header.slice(7))
  if (!claims?.userId || claims.kind) return NextResponse.next() // not a session token of ours (or a platform / selection token)

  let state: CachedUser | null = null
  try {
    state = await currentState(claims.userId, claims.companyId)
  } catch (err) {
    console.error('[proxy] session check unavailable, failing open:', err instanceof Error ? err.message : err)
    return NextResponse.next()
  }
  if (!state) return NextResponse.next()

  const stale = typeof claims.sepoch === 'number' && claims.sepoch !== state.epoch
  // The membership the session was issued for must still exist and be active, and its company must be
  // ACTIVE: removing a user from a company (or suspending the company) ends their sessions there.
  const lostMembership = !!claims.companyId && state.membershipOk === false
  if (!state.isActive || stale || lostMembership) {
    return NextResponse.json(
      // `code` lets the client log out cleanly instead of showing a generic error.
      { error: 'Your session has ended. Please sign in again.', code: 'SESSION_REVOKED' },
      { status: 401 },
    )
  }
  if (claims.companyId && state.companyStatus && state.companyStatus !== 'ACTIVE') {
    return NextResponse.json(
      { error: 'This company account is suspended. Contact your administrator.', code: 'COMPANY_SUSPENDED' },
      { status: 403 },
    )
  }
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
