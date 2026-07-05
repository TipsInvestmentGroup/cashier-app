import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { comparePassword, signToken } from '@/lib/auth'

const MAX_ATTEMPTS = 5
const LOCKOUT_MS = 5 * 60 * 1000 // 5 minutes

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

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user || !user.isActive || user.role !== 'WAITER' || !user.pin) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    if (user.pinLockedUntil && user.pinLockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.pinLockedUntil.getTime() - Date.now()) / 60000)
      return NextResponse.json({ error: `Too many attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.` }, { status: 429 })
    }

    const valid = await comparePassword(String(pin), user.pin)
    if (!valid) {
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

    const outlet = user.outletId ? await prisma.outlet.findUnique({ where: { id: user.outletId } }) : null
    const token = signToken({ userId: user.id, email: user.email, role: user.role, outletId: user.outletId || undefined, name: user.name, position: user.position || undefined })

    return NextResponse.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, position: user.position, outlet },
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
