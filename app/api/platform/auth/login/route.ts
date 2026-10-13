import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { comparePassword, hashPassword } from '@/lib/auth'
import { signPlatformToken, platformAudit } from '@/lib/platform-auth'
import { clearKey, clientIp, isLimited, recordHit, tooMany, type LimitRule } from '@/lib/rate-limit'

// Much tighter than company login: there are only a handful of platform admins.
const IP_RULE: LimitRule = { limit: 10, windowMs: 15 * 60 * 1000 }
const ACCOUNT_RULE: LimitRule = { limit: 5, windowMs: 15 * 60 * 1000 }

let dummyHash: Promise<string> | null = null
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(16).toString('hex')))

/** POST /api/platform/auth/login - body: { email, password }. Platform owners only; company users cannot sign in here. */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}))
  if (!email || !password) return NextResponse.json({ error: 'Email and password required' }, { status: 400 })

  const ipKey = `platform:ip:${clientIp(req)}`
  const acctKey = `platform:acct:${String(email).trim().toLowerCase()}`
  const a = isLimited(ipKey, IP_RULE)
  if (a.limited) return tooMany(a.retryAfterSec)
  const b = isLimited(acctKey, ACCOUNT_RULE)
  if (b.limited) return tooMany(b.retryAfterSec)

  const admin = await prisma.platformAdmin.findUnique({ where: { email: String(email).trim().toLowerCase() } })
  let ok = false
  if (admin && admin.isActive) {
    ok = await comparePassword(String(password), admin.password)
  } else {
    // Unknown / disabled account: spend the same time as a real check so timing reveals nothing.
    await comparePassword(String(password), await getDummyHash()).catch(() => false)
  }
  if (!admin || !admin.isActive || !ok) {
    recordHit(ipKey, IP_RULE); recordHit(acctKey, ACCOUNT_RULE)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }
  clearKey(acctKey)

  await platformAudit(admin.id, 'PLATFORM_LOGIN', 'PlatformAdmin', admin.id)
  return NextResponse.json({ token: signPlatformToken(admin), admin: { id: admin.id, name: admin.name, email: admin.email } })
}
