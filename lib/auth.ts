import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

// A missing JWT_SECRET in production means every token is signed with this
// well-known string — anyone could forge an ADMIN token and bypass all
// authorization in the app. Fail loudly rather than run silently insecure;
// only fall back for local dev, where this file is imported long before any
// request is actually signed/verified.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set in production — refusing to start with a guessable auth secret. Set JWT_SECRET in your deployment environment.')
}
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret'

export interface JWTPayload {
  userId: string
  email: string
  role: string
  outletId?: string
  name: string
  position?: string
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' })
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload
  } catch {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

/** Generates a fresh forgot-password token. The raw token goes in the email
 *  link; only its hash is ever stored, so a DB leak can't be used to reset
 *  accounts. */
export function generateResetToken(): { token: string; tokenHash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex')
  return { token, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) }
}

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function getAuthUser(req: NextRequest): JWTPayload | null {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  return verifyToken(token)
}

export function requireRole(user: JWTPayload | null, roles: string[]): boolean {
  if (!user) return false
  return roles.includes(user.role)
}

// Sentinel that matches no real record id — used to hard-lock a cashier with no
// outlet to an empty result set instead of silently exposing all outlets.
export const NO_OUTLET = '__none__'

// Roles that only ever operate at one physical outlet — CASHIER and WAITER
// both work a single floor/counter day to day, unlike MANAGER/ACCOUNTANT/
// DIRECTOR/ADMIN who legitimately need cross-outlet oversight views. Locked
// here, centrally, so every endpoint that calls readOutletScope gets this for
// free instead of each one needing its own guard (a WAITER-reachable
// endpoint that forgets to pass/lock outletId used to silently return every
// outlet's data — see /api/schedule and /api/search, fixed 2026-07-18).
const SINGLE_OUTLET_ROLES = ['CASHIER', 'WAITER']

/**
 * Effective outlet filter for READS. Single-outlet roles (see
 * SINGLE_OUTLET_ROLES) are strictly locked to their own outlet — any
 * requested outletId is ignored; one with no outlet sees nothing. Everyone
 * else may filter by the requested outletId (or none = all, an intentional
 * cross-outlet oversight view for MANAGER/ACCOUNTANT/DIRECTOR/ADMIN).
 */
export function readOutletScope(user: JWTPayload, requestedOutletId: string | null): string | null {
  if (SINGLE_OUTLET_ROLES.includes(user.role)) return user.outletId || NO_OUTLET
  return requestedOutletId
}

/** True for roles readOutletScope always locks to one outlet — use this to also
 *  scope any OTHER query an endpoint runs alongside the readOutletScope'd one
 *  (e.g. a company-wide "all staff" list that only management should see
 *  unscoped) instead of re-deriving the same role check ad hoc. */
export function isSingleOutletRole(role: string): boolean {
  return SINGLE_OUTLET_ROLES.includes(role)
}

/**
 * Effective outlet for WRITES. Cashiers always write to their own outlet (a
 * body-supplied outletId is ignored). Returns null when it can't be resolved,
 * so callers can reject with "Outlet required".
 */
export function writeOutletId(user: JWTPayload, bodyOutletId?: string | null): string | null {
  if (user.role === 'CASHIER') return user.outletId || null
  return bodyOutletId || user.outletId || null
}
