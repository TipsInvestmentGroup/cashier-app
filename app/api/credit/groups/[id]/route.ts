import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { SETTLEMENT_METHODS } from '@/lib/credit-config'

/** PATCH — update a credit group's editable fields. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.creditGroup.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body.description !== undefined) data.description = body.description ? String(body.description) : null
  if (body.status !== undefined) {
    if (!['ACTIVE', 'INACTIVE'].includes(body.status)) return NextResponse.json({ error: 'status must be ACTIVE or INACTIVE' }, { status: 400 })
    data.status = body.status
  }
  if (body.isCreditBearing !== undefined) data.isCreditBearing = body.isCreditBearing === true
  if (body.requiresApproval !== undefined) data.requiresApproval = body.requiresApproval === true
  if (body.maxCredit !== undefined) data.maxCredit = Number(body.maxCredit) > 0 ? Number(body.maxCredit) : 0
  if (body.paymentTermsDays !== undefined) data.paymentTermsDays = Number(body.paymentTermsDays) > 0 ? Math.floor(Number(body.paymentTermsDays)) : 0
  if (body.gracePeriodDays !== undefined) data.gracePeriodDays = Number(body.gracePeriodDays) > 0 ? Math.floor(Number(body.gracePeriodDays)) : 0
  if (body.riskRating !== undefined) data.riskRating = String(body.riskRating)
  if (body.priority !== undefined && Number.isFinite(Number(body.priority))) data.priority = Math.floor(Number(body.priority))

  // Settlement methods — validate together so the default always stays in the list.
  if (body.settlementMethods !== undefined || body.defaultSettlementMethod !== undefined) {
    let list: string[]
    try { list = JSON.parse(existing.settlementMethods) } catch { list = [] }
    if (body.settlementMethods !== undefined) list = Array.isArray(body.settlementMethods) ? body.settlementMethods.map(String) : []
    if (!list.length) return NextResponse.json({ error: 'At least one settlement method is required' }, { status: 400 })
    for (const m of list) if (!(SETTLEMENT_METHODS as readonly string[]).includes(m)) return NextResponse.json({ error: `Unknown settlement method: ${m}` }, { status: 400 })
    const def = body.defaultSettlementMethod !== undefined ? String(body.defaultSettlementMethod) : existing.defaultSettlementMethod
    if (!list.includes(def)) return NextResponse.json({ error: 'Default settlement method must be one of the allowed methods' }, { status: 400 })
    data.settlementMethods = JSON.stringify(list)
    data.defaultSettlementMethod = def
  }

  const group = await prisma.creditGroup.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'CreditGroup', entityId: id, details: `Updated credit group ${group.name}` },
  })
  return NextResponse.json(group)
}

/** DELETE — soft-delete (status → INACTIVE); historical bills still reference it. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.creditGroup.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

  await prisma.creditGroup.update({ where: { id }, data: { status: 'INACTIVE' } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'CreditGroup', entityId: id, details: `Deactivated credit group ${existing.name}` },
  })
  return NextResponse.json({ ok: true })
}
