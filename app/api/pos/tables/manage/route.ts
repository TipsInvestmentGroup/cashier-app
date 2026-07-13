import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, requireRole } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MANAGE_ROLES = ['ADMIN']

/** GET /api/pos/tables/manage?outletId=... — admin table list (active + inactive), no order data. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const outletId = req.nextUrl.searchParams.get('outletId')
  if (!outletId) return NextResponse.json({ error: 'outletId is required' }, { status: 400 })

  const tables = await prisma.posTable.findMany({
    where: { outletId },
    orderBy: { number: 'asc' },
  })
  return NextResponse.json(tables)
}

/** POST /api/pos/tables/manage — create a table. body: { outletId, number, label?, capacity? } */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!requireRole(user, MANAGE_ROLES)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { outletId, label } = body
  const number = Math.round(Number(body.number))
  const capacity = body.capacity !== undefined ? Math.max(1, Math.round(Number(body.capacity))) : 4
  if (!outletId) return NextResponse.json({ error: 'outletId is required' }, { status: 400 })
  if (!Number.isFinite(number) || number <= 0) return NextResponse.json({ error: 'Table number must be a positive number' }, { status: 400 })

  const existing = await prisma.posTable.findFirst({ where: { outletId, number } })
  if (existing) return NextResponse.json({ error: `Table ${number} already exists at this outlet` }, { status: 409 })

  const table = await prisma.posTable.create({
    data: { outletId, number, label: label?.trim() || null, capacity },
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'PosTable', entityId: table.id, details: `Added table ${number} to outlet ${outletId}` },
  })
  return NextResponse.json(table, { status: 201 })
}
