import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { BUDGET_VALIDATION_MODES } from '@/lib/expense-config'

function normalizeJsonArray(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const list = Array.isArray(value) ? value.map(String).filter(Boolean) : []
  return list.length ? JSON.stringify(list) : null
}

/** PATCH — update a request type's editable fields. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.requestType.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Request type not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
    data.name = name
  }
  if (body.description !== undefined) data.description = body.description ? String(body.description) : null
  if (body.isActive !== undefined) data.isActive = body.isActive === true
  if (body.budgetValidation !== undefined) {
    if (!(BUDGET_VALIDATION_MODES as readonly string[]).includes(body.budgetValidation)) {
      return NextResponse.json({ error: `budgetValidation must be one of ${BUDGET_VALIDATION_MODES.join(', ')}` }, { status: 400 })
    }
    data.budgetValidation = body.budgetValidation
  }
  if (body.requiredFields !== undefined) data.requiredFields = normalizeJsonArray(body.requiredFields)
  if (body.requiredAttachments !== undefined) data.requiredAttachments = normalizeJsonArray(body.requiredAttachments)
  if (body.allowedCategoryIds !== undefined) data.allowedCategoryIds = normalizeJsonArray(body.allowedCategoryIds)
  if (body.allowedFundingSourceIds !== undefined) data.allowedFundingSourceIds = normalizeJsonArray(body.allowedFundingSourceIds)
  if (body.approverRoles !== undefined) data.approverRoles = normalizeJsonArray(body.approverRoles)
  if (body.attributes !== undefined) data.attributes = body.attributes ? JSON.stringify(body.attributes) : null

  const requestType = await prisma.requestType.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'RequestType', entityId: id, details: `Updated request type ${requestType.name}` },
  })
  return NextResponse.json(requestType)
}

/** DELETE — soft-delete (isActive → false); historical requests still reference it. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.requestType.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Request type not found' }, { status: 404 })

  await prisma.requestType.update({ where: { id }, data: { isActive: false } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'RequestType', entityId: id, details: `Deactivated request type ${existing.name}` },
  })
  return NextResponse.json({ ok: true })
}
