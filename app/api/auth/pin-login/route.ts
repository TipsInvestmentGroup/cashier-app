import { NextRequest, NextResponse } from 'next/server'
import { prismaSystem as prisma } from '@/lib/prisma'
import { comparePassword } from '@/lib/auth'
import { ensureMemberships, issueSession, pickMembership, usableMemberships } from '@/lib/tenant'
import { clientIp, isLimited, recordHit, tooMany, type LimitRule } from '@/lib/rate-limit'

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000 // 5 minutes
// Per-IP cap on FAILED PINs, on top of the per-account lockout below: the lockout
// stops a guess run against one waiter, this stops one client sweeping across
// every waiter's account (each only a few guesses) from the public picker.
// Generous so a shared venue network full of fumbled PINs isn't locked out.
const IP_FAIL_RULE: LimitRule = { limit: 60, windowMs: 10 * 60 * 1000 }

/**
 * POST /api/auth/pin-login — public. body: { userId, pin }
 * Streamlined MyPOS sign-in: tap a name on the picker, enter a 4-digit PIN.
 * A 4-digit PIN only has 10,000 combinations, so failed attempts are tracked
 * per-account and locked out for a few minutes after MAX_ATTEMPTS — this is
 * a public, pre-auth endpoint, so it has no other brute-force protection.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, pin } = await req.json().catch(() => ({}))
    if (!userId || !pin) return NextResponse.json({ error: 'Select your name and enter your PIN' }, { status: 400 })

    const ipKey = `pin:ip:${clientIp(req)}`
    const ipState = isLimited(ipKey, IP_FAIL_RULE)
    if (ipState.limited) return tooMany(ipState.retryAfterSec)

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user || !user.isActive || user.role !== 'WAITER' || !user.pin) {
      recordHit(ipKey, IP_FAIL_RULE)
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.pinLockedUntil.getTime() - Date.now()) / 60000)
      return NextResponse.json({ error: `Too many attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.` }, { status: 429 })
    }

    const valid = await comparePassword(String(pin), user.pin)
    if (!valid) {
      recordHit(ipKey, IP_FAIL_RULE)
      // Atomic DB-level increment, not a JS read-then-write — concurrent wrong
      // guesses (e.g. a brute-force script firing many requests at once) each
      // get an accurate, correctly-serialized post-increment count, so the
      // lockout can no longer be raced past by firing attempts in parallel.
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { pinFailedAttempts: { increment: 1 } },
      })
      const lockingOut = updated.pinFailedAttempts >= MAX_ATTEMPTS
      if (lockingOut) {
        await prisma.user.update({
          where: { id: user.id },
          data: { pinFailedAttempts: 0, pinLockedUntil: new Date(Date.now() + LOCKOUT_MS) },
        })
      }
      return NextResponse.json({ error: lockingOut ? 'Too many attempts. Try again in 5 minutes.' : 'Incorrect PIN' }, { status: 401 })
    }

    await prisma.user.update({ where: { id: user.id }, data: { pinFailedAttempts: 0, pinLockedUntil: null } })

    // Bind the session to the company that OWNS the waiter's outlet (a PIN sign-in starts from an outlet
    // tile, so the company is implied by it).
    const homeOutlet = user.outletId ? await prisma.outlet.findUnique({ where: { id: user.outletId } }) : null
    const usable = usableMemberships(await ensureMemberships(prisma, user))
    const chosen = pickMembership(usable, homeOutlet?.companyId) ?? usable[0] ?? null
    if (!chosen) return NextResponse.json({ error: 'Your company access is suspended or has been removed. Contact your manager.' }, { status: 403 })
    const outlet = chosen.outletId === user.outletId ? homeOutlet : chosen.outletId ? await prisma.outlet.findUnique({ where: { id: chosen.outletId } }) : null

    return NextResponse.json(issueSession(user, chosen, outlet))
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
