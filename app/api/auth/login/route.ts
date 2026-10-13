import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomBytes } from 'crypto'
import { comparePassword, hashPassword, signKindToken } from '@/lib/auth'
import { ensureMemberships, issueSession, pickMembership, usableMemberships } from '@/lib/tenant'
import { clearKey, clientIp, isLimited, recordHit, tooMany, type LimitRule } from '@/lib/rate-limit'
import { ownerEmail } from '@/lib/owner'

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
    const { email, password, company } = await req.json().catch(() => ({}))
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
    }

    const ipKey = `login:ip:${clientIp(req)}`
    const acctKey = `login:acct:${String(email).trim().toLowerCase()}`
    const ipState = isLimited(ipKey, IP_RULE)
    if (ipState.limited) return tooMany(ipState.retryAfterSec)
    const acctState = isLimited(acctKey, ACCOUNT_RULE)
    if (acctState.limited) return tooMany(acctState.retryAfterSec)

    const user = await prisma.user.findUnique({ where: { email } })

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

    // The password is right. Now: which COMPANY is this session for? A login identity can belong to
    // several; the session token is bound to exactly one. `company` (code or id) selects it directly;
    // with a single usable company it is automatic; otherwise the caller must choose (short-lived
    // selection token, valid only for POST /api/auth/select-company).
    const all = await ensureMemberships(prisma, user)
    const usable = usableMemberships(all)
    if (usable.length === 0) {
      const msg = all.length === 0 ? 'Your account is not assigned to a company.' : 'Your company access is suspended or has been removed. Contact your administrator.'
      return NextResponse.json({ error: msg }, { status: 403 })
    }
    const chosen = company ? pickMembership(usable, company) : usable.length === 1 ? usable[0] : null
    if (company && !chosen) return NextResponse.json({ error: 'You do not have access to that company.' }, { status: 403 })
    if (!chosen) {
      return NextResponse.json({
        needsCompany: true,
        selectToken: signKindToken({ kind: 'select', userId: user.id, sepoch: user.sessionEpoch }, '5m'),
        companies: usable.map((m) => ({ id: m.company.id, name: m.company.name, slug: m.company.slug })),
      })
    }

    const outlet = chosen.outletId ? await prisma.outlet.findUnique({ where: { id: chosen.outletId } }) : null
    const session = issueSession(user, chosen, outlet)
    return NextResponse.json({ ...session, user: { ...session.user, ownerEmail: ownerEmail() } })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
