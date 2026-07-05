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

/**
 * Effective outlet filter for READS. Cashiers are strictly locked to their own
 * outlet (any requested outletId is ignored); a cashier without an outlet sees
 * nothing. Everyone else may filter by the requested outletId (or none = all).
 */
export function readOutletScope(user: JWTPayload, requestedOutletId: string | null): string | null {
  if (user.role === 'CASHIER') return user.outletId || NO_OUTLET
  return requestedOutletId
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
