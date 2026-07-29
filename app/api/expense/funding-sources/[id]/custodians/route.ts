import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { listFundingSourceCustodians, assignFundingSourceCustodian, removeFundingSourceCustodian } from '@/lib/expense-access'

const VIEWER_ROLES = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

/** GET — every custodian assigned to this funding source. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!VIEWER_ROLES.includes(user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  return NextResponse.json(await listFundingSourceCustodians(id))
}

/** POST — assign a custodian ({ userId }). Admin-only, per the request's
 *  "administrator should be able to assign one or more users as petty cash
 *  custodians". */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const userId = String(body.userId || '')
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  const source = await prisma.fundingSource.findUnique({ where: { id } })
  if (!source) return NextResponse.json({ error: 'Funding source not found' }, { status: 404 })
  const targetUser = await prisma.user.findUnique({ where: { id: userId } })
  if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  await assignFundingSourceCustodian(id, userId)
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'FundingSourceCustodian', entityId: id, details: `Assigned ${targetUser.name} as custodian of ${source.name}` },
  })
  return NextResponse.json(await listFundingSourceCustodians(id), { status: 201 })
}

/** DELETE — remove a custodian (?userId=). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 })

  await removeFundingSourceCustodian(id, userId)
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'FundingSourceCustodian', entityId: id, details: `Removed custodian ${userId}` },
  })
  return NextResponse.json({ ok: true })
}
