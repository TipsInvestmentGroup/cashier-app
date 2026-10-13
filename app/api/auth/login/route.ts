import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'
import { comparePassword, hashPassword, signToken } from '@/lib/auth'
import { clearKey, clientIp, isLimited, recordHit, tooMany, type LimitRule } from '@/lib/rate-limit'
import { isOwnerEmail, ownerEmail } from '@/lib/owner'

// Failed-attempt budgets. Per IP (a script hammering many accounts) and per
// account (a script hammering one account from many IPs). Only FAILURES count,
// so a busy shared-NAT venue full of legitimate logins is never throttled.
const IP_RULE: LimitRule = { limit: 30, windowMs: 10 * 60 * 1000 }
const ACCOUNT_RULE: LimitRule = { limit: 8, windowMs: 10 * 60 * 1000 }

// A valid bcrypt hash of a random string, compared against when the account
// doesn't exist so "unknown email" costs the same time as "wrong password" and
// response timing can't be used to enumerate registered emails.
let dummyHash: Promise<string> | null = null
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')))

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json().catch(() => ({}))
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }

    const ipKey = `login:ip:${clientIp(req)}`
    const acctKey = `login:acct:${String(email).trim().toLowerCase()}`
    const ipState = isLimited(ipKey, IP_RULE)
    if (ipState.limited) return tooMany(ipState.retryAfterSec)
    const acctState = isLimited(acctKey, ACCOUNT_RULE)
    if (acctState.limited) return tooMany(acctState.retryAfterSec)

    const user = await prisma.user.findUnique({
      where: { email },
      include: { outlet: true },
    })

    const fail = async () => {
      recordHit(ipKey, IP_RULE)
      recordHit(acctKey, ACCOUNT_RULE)
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // `@staff.internal` addresses are placeholders for PIN-only floor staff (see seed-core); those
    // accounts sign in via the PIN picker, never email+password. Older databases were seeded with a
    // fixed password on them, so refuse the email route outright for that domain.
    const pinOnly = String(email).trim().toLowerCase().endsWith('@staff.internal')

    if (!user || !user.isActive || pinOnly) {
      await comparePassword(String(password), await getDummyHash()).catch(() => false)
      return fail()
    }

    const valid = await comparePassword(password, user.password)
    if (!valid) return fail()
    clearKey(acctKey)

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      outletId: user.outletId || undefined,
      name: user.name,
      position: user.position || undefined,
      sepoch: user.sessionEpoch,
    })

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        position: user.position,
        outlet: user.outlet,
        isOwner: isOwnerEmail(user.email),
        ownerEmail: ownerEmail(),
      },
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
