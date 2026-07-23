import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { COMPONENT_TYPES, CALC_METHODS, validateParameters } from '../route'

// Edit / soft-delete one pay component. ADMIN-only. Components are soft-deleted
// (status INACTIVE) because historical payslip lines reference them by code.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.payComponent.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Component not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.name !== undefined) { const n = String(body.name).trim(); if (!n) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 }); data.name = n }
  if (body.description !== undefined) data.description = body.description ? String(body.description).trim() : null
  if (body.status !== undefined) {
    if (!['ACTIVE', 'INACTIVE'].includes(body.status)) return NextResponse.json({ error: 'status must be ACTIVE or INACTIVE' }, { status: 400 })
    data.status = body.status
  }
  if (body.componentType !== undefined) {
    if (!COMPONENT_TYPES.includes(body.componentType)) return NextResponse.json({ error: `componentType must be one of ${COMPONENT_TYPES.join(', ')}` }, { status: 400 })
    data.componentType = body.componentType
  }

  // If calc method or parameters change, re-validate the whole shape together.
  const calcMethod = body.calcMethod ?? existing.calcMethod
  if (body.calcMethod !== undefined) {
    if (!CALC_METHODS.includes(body.calcMethod)) return NextResponse.json({ error: `calcMethod must be one of ${CALC_METHODS.join(', ')}` }, { status: 400 })
    data.calcMethod = body.calcMethod
  }
  if (body.calcMethod !== undefined || body.parameters !== undefined || body.formulaId !== undefined) {
    const params = (body.parameters && typeof body.parameters === 'object') ? body.parameters as Record<string, unknown> : {}
    const formulaId = body.formulaId !== undefined ? body.formulaId : existing.formulaId
    const err = validateParameters(calcMethod, params, formulaId)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    data.parameters = calcMethod === 'FORMULA' ? null : JSON.stringify(params)
    data.formulaId = calcMethod === 'FORMULA' ? formulaId : null
  }

  if (body.taxable !== undefined) data.taxable = !!body.taxable
  if (body.pensionable !== undefined) data.pensionable = !!body.pensionable
  if (body.proratable !== undefined) data.proratable = !!body.proratable
  if (body.priority !== undefined) data.priority = Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0
  if (body.glMappingKey !== undefined) data.glMappingKey = body.glMappingKey ? String(body.glMappingKey).trim() : null
  if (body.minLimit !== undefined) data.minLimit = body.minLimit === null || body.minLimit === '' ? null : Number(body.minLimit)
  if (body.maxLimit !== undefined) data.maxLimit = body.maxLimit === null || body.maxLimit === '' ? null : Number(body.maxLimit)

  await prisma.payComponent.update({ where: { id }, data })

  // Reconcile group-level assignments to match payGroupIds (leaves employee-level
  // assignments untouched). New groups get an assignment; removed group rows that
  // carry no override are deleted (pre-launch config, no history to preserve yet).
  if (Array.isArray(body.payGroupIds)) {
    const want = new Set<string>(body.payGroupIds)
    const current = await prisma.componentAssignment.findMany({ where: { componentId: id, payGroupId: { not: null } } })
    for (const a of current) {
      if (!want.has(a.payGroupId as string) && a.parametersOverride == null && a.amountOverride == null) {
        await prisma.componentAssignment.delete({ where: { id: a.id } })
      }
    }
    const have = new Set(current.map((a) => a.payGroupId as string))
    for (const pgId of want) if (!have.has(pgId)) await prisma.componentAssignment.create({ data: { componentId: id, payGroupId: pgId } })
  }

  await prisma.auditLog.create({ data: { userId: user.userId, action: 'UPDATE', entity: 'PayComponent', entityId: id, details: `Updated pay component ${existing.code}` } })
  return NextResponse.json({ component: await prisma.payComponent.findUnique({ where: { id } }) })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.payComponent.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Component not found' }, { status: 404 })

  await prisma.payComponent.update({ where: { id }, data: { status: 'INACTIVE' } })
  await prisma.auditLog.create({ data: { userId: user.userId, action: 'DELETE', entity: 'PayComponent', entityId: id, details: `Deactivated pay component ${existing.code}` } })
  return NextResponse.json({ ok: true })
}
