import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { getAuthUser, hashPassword } from '@/lib/auth'
import { VALID_ROLES } from '@/lib/shared-constants'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
const isOwner = (email?: string) => !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL
const PIN_RE = /^\d{4}$/

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER', 'DIRECTOR'].includes(user.role) && !isOwner(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, position: true, pin: true, outlet: true, isActive: true, isCasual: true, createdAt: true },
    orderBy: { name: 'asc' },
  })
  // Never expose the pin hash — just whether one is set.
  const safe = users.map(({ pin, ...u }) => ({ ...u, hasPin: !!pin }))

  return NextResponse.json(safe)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'DIRECTOR'].includes(user.role) && !isOwner(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email, password, role, outletId, pin, position, isCasual } = await req.json()
  if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  if (pin && !PIN_RE.test(String(pin))) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
  const casual = !!isCasual
  // Casual/temporary workers don't log in themselves, so email+password aren't
  // collected from the form — auto-fill a unique placeholder so the (required,
  // unique) columns are still satisfied.
  if (!casual && !email) return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  if (!casual && !password) return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  const finalEmail = email || `casual-${randomBytes(6).toString('hex')}@internal.local`
  const hashed = await hashPassword(password || randomBytes(12).toString('hex'))

  const newUser = await prisma.user.create({
    data: {
      name, email: finalEmail, password: hashed, role, outletId: outletId || null,
      position: position || null,
      pin: pin ? await hashPassword(String(pin)) : null,
      isCasual: casual,
    },
    select: { id: true, name: true, email: true, role: true, position: true, outlet: true, isCasual: true },
  })

  return NextResponse.json(newUser, { status: 201 })
}
