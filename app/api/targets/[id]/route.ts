import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'

const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any

function requireAdmin(user: { role: string } | null) {
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Only an Admin can manage targets' }, { status: 403 })
  return null
}

/** Edit a target's weekly figure / department / unit label, or deactivate it. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  const denied = requireAdmin(user)
  if (denied) return denied

  const { id } = await params
  const existing = await db.salesTarget.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Target not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (body.weeklyTarget !== undefined) {
    const weekly = Number(body.weeklyTarget)
    if (!Number.isFinite(weekly) || weekly <= 0) return NextResponse.json({ error: 'Weekly target must be > 0' }, { status: 400 })
    data.weeklyTarget = weekly
  }
  if (body.department !== undefined) {
    if (!String(body.department).trim()) return NextResponse.json({ error: 'Department is required' }, { status: 400 })
    data.department = String(body.department).trim()
  }
  if (body.unitLabel !== undefined) data.unitLabel = String(body.unitLabel || '').trim() || null
  if (body.isActive !== undefined) data.isActive = !!body.isActive

  const item = await db.salesTarget.update({ where: { id }, data })
  await prisma.auditLog.create({ data: { userId: user!.userId, action: 'UPDATE', entity: 'SalesTarget', entityId: id, details: `Target updated: ${item.department} = ${item.weeklyTarget}/wk${item.isActive ? '' : ' (deactivated)'}` } })
  return NextResponse.json(item)
}

/** Delete a target permanently. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  const denied = requireAdmin(user)
  if (denied) return denied

  const { id } = await params
  const existing = await db.salesTarget.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Target not found' }, { status: 404 })

  await db.salesTarget.delete({ where: { id } })
  await prisma.auditLog.create({ data: { userId: user!.userId, action: 'DELETE', entity: 'SalesTarget', entityId: id, details: `Target deleted: ${existing.department} (${existing.scope})` } })
  return NextResponse.json({ ok: true })
}
