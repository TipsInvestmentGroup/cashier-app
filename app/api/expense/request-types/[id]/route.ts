import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { BUDGET_VALIDATION_MODES, VERIFICATION_STAGES } from '@/lib/expense-config'

function normalizeJsonArray(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const list = Array.isArray(value) ? value.map(String).filter(Boolean) : []
  return list.length ? JSON.stringify(list) : null
}

function normalizeVerificationStages(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const list = Array.isArray(value) ? value.map(String) : []
  for (const s of list) {
    if (!(VERIFICATION_STAGES as readonly string[]).includes(s)) throw new Error(`Unknown verification stage: ${s}`)
  }
  return list.length ? JSON.stringify(list) : null
}

function parseIdArray(raw: string | null): string[] {
  if (!raw) return []
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p.map(String) : [] } catch { return [] }
}

/**
 * Returns an inline error message if this request type is scoped to a category
 * or funding source that is no longer live (inactive or archived), else null.
 * An empty allow-list ("all") has no specific dependency to check.
 */
async function findInactiveScopeDependency(rt: { allowedCategoryIds: string | null; allowedFundingSourceIds: string | null }): Promise<string | null> {
  const categoryIds = parseIdArray(rt.allowedCategoryIds)
  if (categoryIds.length) {
    const cat = await prisma.expenseCategory.findFirst({
      where: { id: { in: categoryIds }, OR: [{ isActive: false }, { archived: true }] },
      select: { name: true },
    })
    if (cat) return `Can't activate — linked category '${cat.name}' is inactive.`
  }
  const fundIds = parseIdArray(rt.allowedFundingSourceIds)
  if (fundIds.length) {
    const fund = await prisma.fundingSource.findFirst({
      where: { id: { in: fundIds }, OR: [{ isActive: false }, { archived: true }] },
      select: { name: true },
    })
    if (fund) return `Can't activate — linked funding source '${fund.name}' is inactive.`
  }
  return null
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
  if (body.requiredVerificationStages !== undefined) {
    try {
      data.requiredVerificationStages = normalizeVerificationStages(body.requiredVerificationStages)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid requiredVerificationStages' }, { status: 400 })
    }
  }
  if (body.attributes !== undefined) data.attributes = body.attributes ? JSON.stringify(body.attributes) : null

  // Reactivation guard: a request type is only usable if the categories and
  // funding sources it is scoped to (its "budget check config") are themselves
  // still live. Re-enabling one that points at a deactivated/archived category
  // or fund would offer users a type they can never complete, so block it and
  // name the offending dependency. Only checked on inactive→active; an empty
  // allow-list means "all", which has nothing specific to validate.
  if (body.isActive === true && !existing.isActive) {
    const blocked = await findInactiveScopeDependency(existing)
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })
  }

  const requestType = await prisma.requestType.update({ where: { id }, data })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'RequestType', entityId: id, details: `Updated request type ${requestType.name}` },
  })
  return NextResponse.json(requestType)
}

/**
 * DELETE — three modes via ?mode= (see the categories route for the full
 * contract): none = Deactivate (reversible), archive = retire but keep for
 * history, hard = permanently remove. Hard is refused (409) while any request
 * still references it. The count is re-derived server-side.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const existing = await prisma.requestType.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Request type not found' }, { status: 404 })

  const mode = req.nextUrl.searchParams.get('mode')

  if (mode === 'hard') {
    const requests = await prisma.expenseRequest.count({ where: { requestTypeId: id } })
    if (requests > 0) {
      return NextResponse.json({ error: `${existing.name} has ${requests} linked request(s) and can't be permanently deleted. Archive it instead.` }, { status: 409 })
    }
    // Custom fields are owned by this type and meaningless without it — remove
    // them in the same transaction so the hard delete doesn't hit their FK.
    await prisma.$transaction([
      prisma.requestTypeField.deleteMany({ where: { requestTypeId: id } }),
      prisma.requestType.delete({ where: { id } }),
    ])
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'DELETE', entity: 'RequestType', entityId: id, details: `Permanently deleted request type ${existing.name}` },
    })
    return NextResponse.json({ ok: true, action: 'deleted' })
  }

  if (mode === 'archive') {
    await prisma.requestType.update({ where: { id }, data: { archived: true, isActive: false } })
    await prisma.auditLog.create({
      data: { userId: user.userId, action: 'UPDATE', entity: 'RequestType', entityId: id, details: `Archived request type ${existing.name}` },
    })
    return NextResponse.json({ ok: true, action: 'archived' })
  }

  await prisma.requestType.update({ where: { id }, data: { isActive: false } })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'DELETE', entity: 'RequestType', entityId: id, details: `Deactivated request type ${existing.name}` },
  })
  return NextResponse.json({ ok: true, action: 'deactivated' })
}
