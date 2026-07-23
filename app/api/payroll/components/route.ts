import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveCompanyId } from '@/lib/payroll-config'

// Pay components — the configurable payslip-line definitions that drive what a
// run calculates (the payroll analogue of CreditGroup). ADMIN-only, like the
// other payroll configuration surfaces. Group-level assignments are managed here
// too; employee-level overrides are a deeper feature handled elsewhere.
export const COMPONENT_TYPES = ['EARNING', 'ALLOWANCE', 'BENEFIT', 'DEDUCTION', 'STATUTORY', 'EMPLOYER_CONTRIBUTION'] as const
export const CALC_METHODS = ['FIXED', 'PERCENTAGE', 'RATE_QTY', 'TABLE', 'FORMULA', 'SOURCED'] as const
export const SOURCES = ['CREDIT_BALANCE', 'STATUTORY', 'MANUAL', 'LOAN_SCHEDULE', 'ADVANCE'] as const

function bucketOf(type: string): 'EARNING' | 'DEDUCTION' | 'EMPLOYER' {
  if (['DEDUCTION', 'STATUTORY'].includes(type)) return 'DEDUCTION'
  if (type === 'EMPLOYER_CONTRIBUTION') return 'EMPLOYER'
  return 'EARNING'
}
function safeJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/** Validate a calc-method's parameters object. Returns an error string or null. */
export function validateParameters(calcMethod: string, params: Record<string, unknown>, formulaId?: string | null): string | null {
  switch (calcMethod) {
    case 'FIXED':
      if (!(Number(params.amount) >= 0)) return 'A fixed amount (≥ 0) is required'
      return null
    case 'PERCENTAGE':
      if (!Number.isFinite(Number(params.percent))) return 'A percent is required'
      if (!params.of) return 'A base variable ("of") is required'
      return null
    case 'RATE_QTY':
      if (!Number.isFinite(Number(params.rate))) return 'A rate is required'
      if (!params.qtyVar) return 'A quantity variable is required'
      return null
    case 'TABLE':
      if (!params.var) return 'A table variable is required'
      if (!Array.isArray(params.bands) || params.bands.length === 0) return 'At least one tax band is required'
      return null
    case 'SOURCED':
      if (!SOURCES.includes(params.source as (typeof SOURCES)[number])) return `source must be one of ${SOURCES.join(', ')}`
      return null
    case 'FORMULA':
      if (!formulaId) return 'A formula must be selected for a FORMULA component'
      return null
    default:
      return `Unknown calc method ${calcMethod}`
  }
}

export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const companyId = await resolveCompanyId(prisma, null)
  const where = companyId ? { companyId } : {}

  const [components, payGroups, formulas] = await Promise.all([
    prisma.payComponent.findMany({
      where,
      include: { formula: { select: { id: true, code: true } }, assignments: { select: { payGroupId: true, employeeId: true } } },
      orderBy: [{ componentType: 'asc' }, { priority: 'asc' }, { name: 'asc' }],
    }),
    prisma.payGroup.findMany({ where, orderBy: { priority: 'asc' }, select: { id: true, code: true, name: true, status: true } }),
    prisma.payrollFormula.findMany({ where, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, expression: true } }),
  ])

  const rows = components.map((c) => ({
    id: c.id, code: c.code, name: c.name, description: c.description, status: c.status,
    componentType: c.componentType, bucket: bucketOf(c.componentType), calcMethod: c.calcMethod,
    parameters: safeJson(c.parameters), taxable: c.taxable, pensionable: c.pensionable,
    proratable: c.proratable, priority: c.priority, glMappingKey: c.glMappingKey,
    minLimit: c.minLimit, maxLimit: c.maxLimit, frequency: c.frequency,
    formulaId: c.formulaId, formulaCode: c.formula?.code ?? null,
    payGroupIds: c.assignments.filter((a) => a.payGroupId).map((a) => a.payGroupId as string),
    employeeAssignmentCount: c.assignments.filter((a) => a.employeeId).length,
  }))

  return NextResponse.json({ components: rows, payGroups, formulas })
}

export async function POST(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const code = String(body.code ?? '').trim().toUpperCase().replace(/\s+/g, '_')
  const name = String(body.name ?? '').trim()
  if (!code) return NextResponse.json({ error: 'Code is required' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!COMPONENT_TYPES.includes(body.componentType)) return NextResponse.json({ error: `componentType must be one of ${COMPONENT_TYPES.join(', ')}` }, { status: 400 })
  if (!CALC_METHODS.includes(body.calcMethod)) return NextResponse.json({ error: `calcMethod must be one of ${CALC_METHODS.join(', ')}` }, { status: 400 })

  const params = (body.parameters && typeof body.parameters === 'object') ? body.parameters as Record<string, unknown> : {}
  const paramError = validateParameters(body.calcMethod, params, body.formulaId)
  if (paramError) return NextResponse.json({ error: paramError }, { status: 400 })

  const companyId = await resolveCompanyId(prisma, null)
  if (!companyId) return NextResponse.json({ error: 'No company resolved' }, { status: 400 })

  const dup = await prisma.payComponent.findUnique({ where: { companyId_code: { companyId, code } } }).catch(() => null)
  if (dup) return NextResponse.json({ error: `A component with code ${code} already exists` }, { status: 409 })

  const created = await prisma.payComponent.create({
    data: {
      companyId, code, name, description: body.description ? String(body.description).trim() : null,
      status: 'ACTIVE', componentType: body.componentType, calcMethod: body.calcMethod,
      parameters: body.calcMethod === 'FORMULA' ? null : JSON.stringify(params),
      formulaId: body.calcMethod === 'FORMULA' ? body.formulaId : null,
      taxable: !!body.taxable, pensionable: !!body.pensionable, proratable: !!body.proratable,
      priority: Number.isFinite(Number(body.priority)) ? Number(body.priority) : 0,
      glMappingKey: body.glMappingKey ? String(body.glMappingKey).trim() : null,
      minLimit: body.minLimit === null || body.minLimit === undefined || body.minLimit === '' ? null : Number(body.minLimit),
      maxLimit: body.maxLimit === null || body.maxLimit === undefined || body.maxLimit === '' ? null : Number(body.maxLimit),
    },
  })

  // Group-level assignments for the selected pay groups.
  const payGroupIds: string[] = Array.isArray(body.payGroupIds) ? body.payGroupIds : []
  for (const pgId of payGroupIds) {
    await prisma.componentAssignment.create({ data: { componentId: created.id, payGroupId: pgId } })
  }

  await prisma.auditLog.create({ data: { userId: user.userId, action: 'CREATE', entity: 'PayComponent', entityId: created.id, details: `Created pay component ${code}` } })
  return NextResponse.json({ component: created }, { status: 201 })
}
