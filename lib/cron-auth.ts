import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Shared-secret check for machine endpoints (Vercel Cron, CI deploy seed,
 * ops scripts): /api/cron/*, /api/admin/seed, /api/admin/reset, /api/pos/setup.
 *
 * The secret is accepted ONLY from the `x-cron-secret` header or an
 * `Authorization: Bearer <secret>` header (which is what Vercel Cron sends
 * automatically). It is deliberately NOT read from the query string: URLs end
 * up in access logs, browser history, proxy logs and Referer headers, so a
 * `?secret=` value is effectively published to everyone who can read those.
 *
 * Compared in constant time so response timing can't be used to recover it.
 */
export function cronSecretProvided(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization') || ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  return req.headers.get('x-cron-secret') || bearer
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) {
    // Still do a comparison so timing doesn't reveal a length mismatch cheaply.
    crypto.timingSafeEqual(ab, ab)
    return false
  }
  return crypto.timingSafeEqual(ab, bb)
}

export function cronSecretOk(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided = cronSecretProvided(req)
  return !!provided && safeEqual(provided, secret)
}

/**
 * Returns a ready-made error response when the caller is NOT authorised, or
 * null when the secret is valid. Usage:
 *   const denied = requireCronSecret(req); if (denied) return denied
 */
export function requireCronSecret(req: NextRequest): NextResponse | null {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 500 })
  }
  if (req.nextUrl.searchParams.has('secret')) {
    // Fail loudly so a stale caller notices instead of silently "working" — and
    // so a secret that was already put in a URL gets rotated.
    return NextResponse.json(
      { error: 'The secret must be sent in the x-cron-secret header (or Authorization: Bearer), not the URL query string.' },
      { status: 400 },
    )
  }
  if (!cronSecretOk(req)) return NextResponse.json({ error: 'Invalid secret' }, { status: 401 })
  return null
}
