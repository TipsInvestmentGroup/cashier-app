import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { BUDGET_VALIDATION_MODES } from '@/lib/expense-config'

// Normalizes an optional JSON string-array field (requiredFields,
// requiredAttachments, allowed*Ids, approverRoles). null/undefined/empty
// array all mean "no restriction" and are stored as null, not "[]", so
// resolvers don't have to special-case an empty-but-present array.
function normalizeJsonArray(value: unknown): string | null {
  if (value === undefined || value === null) return null
  const list = Array.isArray(value) ? value.map(String).filter(Boolean) : []
  return list.length ? JSON.stringify(list) : null
}

/** GET — list request types (ADMIN-only; Expense Settings). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const types = await prisma.requestType.findMany({
    orderBy: [{ name: 'asc' }],
    include: { _count: { select: { requests: true } } },
  })
  return NextResponse.json(types)
}

/** POST — create a request type. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const code = String(body.code || name).trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_')
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const budgetValidation = body.budgetValidation !== undefined ? String(body.budgetValidation) : 'WARN'
  if (!(BUDGET_VALIDATION_MODES as readonly string[]).includes(budgetValidation)) {
    return NextResponse.json({ error: `budgetValidation must be one of ${BUDGET_VALIDATION_MODES.join(', ')}` }, { status: 400 })
  }

  const companyId = await resolveDefaultCompanyId(prisma)
  if (!companyId) return NextResponse.json({ error: 'No company configured' }, { status: 400 })

  const dupe = await prisma.requestType.findUnique({ where: { companyId_code: { companyId, code } } })
  if (dupe) return NextResponse.json({ error: `A request type with code ${code} already exists` }, { status: 409 })

  const requestType = await prisma.requestType.create({
    data: {
      companyId,
      code,
      name,
      description: body.description ? String(body.description) : null,
      isActive: true,
      requiredFields: normalizeJsonArray(body.requiredFields),
      requiredAttachments: normalizeJsonArray(body.requiredAttachments),
      allowedCategoryIds: normalizeJsonArray(body.allowedCategoryIds),
      allowedFundingSourceIds: normalizeJsonArray(body.allowedFundingSourceIds),
      budgetValidation,
      approverRoles: normalizeJsonArray(body.approverRoles),
      attributes: body.attributes ? JSON.stringify(body.attributes) : null,
    },
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'RequestType', entityId: requestType.id, details: `Created request type ${name} (${code})` },
  })
  return NextResponse.json(requestType, { status: 201 })
}
