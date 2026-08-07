import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { BUDGET_VALIDATION_MODES, VERIFICATION_STAGES } from '@/lib/expense-config'

// Normalizes an optional JSON string-array field (requiredFields,
// requiredAttachments, allowed*Ids, approverRoles, requiredVerificationStages).
// null/undefined/empty array all mean "no restriction" and are stored as
// null, not "[]", so resolvers don't have to special-case an empty-but-present
// array.
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

/** GET — list request types. Any authenticated user (the New Expense Request
 *  form needs this to render); non-ADMIN only sees active ones — inactive
 *  rows are Expense Settings' concern. */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Archived rows are hidden from EVERY caller (admin included) — kept only so
  // historical requests stay readable, never re-selectable. ADMIN still sees
  // inactive-but-not-archived rows to manage them in Expense Settings.
  const types = await prisma.requestType.findMany({
    where: user.role === 'ADMIN' ? { archived: false } : { isActive: true, archived: false },
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

  let requiredVerificationStages: string | null
  try {
    requiredVerificationStages = normalizeVerificationStages(body.requiredVerificationStages)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid requiredVerificationStages' }, { status: 400 })
  }

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
      requiredVerificationStages,
      attributes: body.attributes ? JSON.stringify(body.attributes) : null,
    },
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'RequestType', entityId: requestType.id, details: `Created request type ${name} (${code})` },
  })
  return NextResponse.json(requestType, { status: 201 })
}
