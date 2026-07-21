import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { SETTLEMENT_METHODS, type SettlementMethod } from '@/lib/credit-config'

// Validate a settlement-methods payload: a non-empty array of known methods,
// with the chosen default contained in it. Returns a normalized JSON string.
function normalizeSettlement(methods: unknown, def: unknown): { json: string; def: string } | { error: string } {
  const list = Array.isArray(methods) ? methods.map(String) : []
  if (!list.length) return { error: 'At least one settlement method is required' }
  for (const m of list) if (!(SETTLEMENT_METHODS as readonly string[]).includes(m)) return { error: `Unknown settlement method: ${m}` }
  const defStr = String(def || list[0])
  if (!list.includes(defStr)) return { error: 'Default settlement method must be one of the allowed methods' }
  return { json: JSON.stringify(list), def: defStr }
}

/** GET — list credit groups (ADMIN-only; Credit Settings). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const groups = await prisma.creditGroup.findMany({
    orderBy: [{ priority: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { accountLinks: true, signedBills: true } } },
  })
  return NextResponse.json(groups)
}

/** POST — create a credit group. */
export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9_]+/g, '_')
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const settlement = normalizeSettlement(body.settlementMethods, body.defaultSettlementMethod)
  if ('error' in settlement) return NextResponse.json({ error: settlement.error }, { status: 400 })

  const companyId = await resolveDefaultCompanyId(prisma)
  if (!companyId) return NextResponse.json({ error: 'No company configured' }, { status: 400 })

  const dupe = await prisma.creditGroup.findUnique({ where: { companyId_code: { companyId, code } } })
  if (dupe) return NextResponse.json({ error: `A group with code ${code} already exists` }, { status: 409 })

  const group = await prisma.creditGroup.create({
    data: {
      companyId,
      code,
      name,
      description: body.description ? String(body.description) : null,
      status: 'ACTIVE',
      legacyBillTypeCode: body.legacyBillTypeCode ? String(body.legacyBillTypeCode) : null,
      isCreditBearing: body.isCreditBearing !== false,
      requiresApproval: body.requiresApproval === true,
      settlementMethods: settlement.json,
      defaultSettlementMethod: settlement.def as SettlementMethod,
      maxCredit: Number(body.maxCredit) > 0 ? Number(body.maxCredit) : 0,
      paymentTermsDays: Number(body.paymentTermsDays) > 0 ? Math.floor(Number(body.paymentTermsDays)) : 0,
      gracePeriodDays: Number(body.gracePeriodDays) > 0 ? Math.floor(Number(body.gracePeriodDays)) : 0,
      riskRating: body.riskRating ? String(body.riskRating) : 'LOW',
      priority: Number.isFinite(Number(body.priority)) ? Math.floor(Number(body.priority)) : 0,
    },
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'CREATE', entity: 'CreditGroup', entityId: group.id, details: `Created credit group ${name} (${code})` },
  })
  return NextResponse.json(group, { status: 201 })
}
