import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser, hashPassword } from '@/lib/auth'

const OWNER_EMAIL = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
const isOwner = (email?: string) => !!OWNER_EMAIL && (email || '').toLowerCase() === OWNER_EMAIL

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(user.role) && !isOwner(user.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, outlet: true, isActive: true, createdAt: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(users)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN' && !isOwner(user.email)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, email, password, role, outletId } = await req.json()
  const hashed = await hashPassword(password)

  const newUser = await prisma.user.create({
    data: { name, email, password: hashed, role, outletId: outletId || null },
    select: { id: true, name: true, email: true, role: true, outlet: true },
  })

  return NextResponse.json(newUser, { status: 201 })
}
