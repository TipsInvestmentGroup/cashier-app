import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { companyKey } from '@/lib/tenant'

export async function GET(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

  const extras = await prisma.posProductExtra.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  })
  return NextResponse.json(extras)
}

export async function POST(req: NextRequest) {
  const payload = getAuthUser(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!['ADMIN', 'MANAGER'].includes(payload.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { name } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const companyId = await companyKey()
  const extra = await prisma.posProductExtra.upsert({
    where: { companyId_name: { companyId, name: name.trim() } },
    update: { isActive: true },
    create: { name: name.trim(), companyId },
  })
  return NextResponse.json(extra, { status: 201 })
}
