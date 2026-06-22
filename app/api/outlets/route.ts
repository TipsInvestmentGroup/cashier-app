import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cashiers only ever deal with their own outlet — never expose others.
  const where: Record<string, unknown> = { isActive: true }
  if (user.role === 'CASHIER') where.id = user.outletId || '__none__'

  const outlets = await prisma.outlet.findMany({
    where,
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(outlets)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name, location } = await req.json()
  const outlet = await prisma.outlet.create({ data: { name, location } })
  return NextResponse.json(outlet, { status: 201 })
}
