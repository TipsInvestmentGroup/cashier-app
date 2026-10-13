import { NextRequest, NextResponse } from 'next/server'

/**
 * Small fixed-window rate limiter for the public, pre-authentication endpoints
 * (login, PIN login, forgot/reset password, pre-login pickers, public bookings).
 *
 * LIMITATION (by design, Phase 1): state lives in process memory, so on
 * serverless hosting each warm instance keeps its own counters. That blunts
 * scripted guessing and floods from a single client — which is what these
 * endpoints were completely open to — but it is NOT a global guarantee. The
 * per-account PIN lockout in the database remains the authoritative brute-force
 * control for PIN login. A shared store (database table / Redis) replaces this
 * in the multi-tenant schema work (Phase 3); callers don't need to change.
 */

interface Bucket { count: number; resetAt: number }
const store = new Map<string, Bucket>()
const MAX_KEYS = 10_000

function sweep(now: number) {
  if (store.size < MAX_KEYS) return
  for (const [k, b] of store) if (b.resetAt <= now) store.delete(k)
  // Still huge (all live)? Drop the oldest entries rather than grow unbounded.
  if (store.size >= MAX_KEYS) {
    let drop = store.size - MAX_KEYS + 1000
    for (const k of store.keys()) { store.delete(k); if (--drop <= 0) break }
  }
}

export interface LimitRule { limit: number; windowMs: number }

/** Best-effort client IP. Vercel puts the real client first in x-forwarded-for. */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim() || 'unknown'
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Is `key` currently over its limit? Does not count a hit. */
export function isLimited(key: string, rule: LimitRule): { limited: boolean; retryAfterSec: number } {
  const now = Date.now()
  const b = store.get(key)
  if (!b || b.resetAt <= now) return { limited: false, retryAfterSec: 0 }
  return { limited: b.count >= rule.limit, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) }
}

/** Count one hit against `key`. Returns the post-increment limited state. */
export function recordHit(key: string, rule: LimitRule): { limited: boolean; retryAfterSec: number } {
  const now = Date.now()
  sweep(now)
  let b = store.get(key)
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + rule.windowMs }; store.set(key, b) }
  b.count += 1
  return { limited: b.count > rule.limit, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) }
}

export function clearKey(key: string) { store.delete(key) }

/** Standard 429 response. */
export function tooMany(retryAfterSec: number, message = 'Too many attempts. Please wait and try again.') {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  )
}

/**
 * Convenience for endpoints where EVERY request counts (not just failures):
 * returns a 429 response when over the limit, otherwise null.
 */
export function limitEveryRequest(req: NextRequest, scope: string, rule: LimitRule): NextResponse | null {
  const res = recordHit(`${scope}:${clientIp(req)}`, rule)
  return res.limited ? tooMany(res.retryAfterSec) : null
}
