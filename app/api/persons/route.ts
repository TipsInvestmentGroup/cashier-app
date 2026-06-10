import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')

  const persons = await prisma.person.findMany({
    where: type ? { type, isActive: true } : { isActive: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json(persons)
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['ADMIN', 'ACCOUNTANT', 'MANAGER'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { name, phone, email, type, creditLimit } = body

  const person = await prisma.person.create({
    data: { name, phone, email, type, creditLimit: Number(creditLimit) || 0 },
  })

  return NextResponse.json(person, { status: 201 })
}
