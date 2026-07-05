import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, hashPassword } from '@/lib/auth'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
const isOwner = (email?: string) => !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL
const PIN_RE = /^\d{4}$/

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(user.role) && !isOwner(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, position: true, pin: true, outlet: true, isActive: true, createdAt: true },
    orderBy: { name: 'asc' },
  })
  // Never expose the pin hash — just whether one is set.
  const safe = users.map(({ pin, ...u }) => ({ ...u, hasPin: !!pin }))

  return NextResponse.json(safe)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && !isOwner(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email, password, role, outletId, pin, position } = await req.json()
  if (pin && !PIN_RE.test(String(pin))) return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
  const hashed = await hashPassword(password)

  const newUser = await prisma.user.create({
    data: {
      name, email, password: hashed, role, outletId: outletId || null,
      position: position || null,
      pin: pin ? await hashPassword(String(pin)) : null,
    },
    select: { id: true, name: true, email: true, role: true, position: true, outlet: true },
  })

  return NextResponse.json(newUser, { status: 201 })
}
