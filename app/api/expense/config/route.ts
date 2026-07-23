import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import { resolveExpenseModuleConfig, setExpenseModuleConfig, OVER_BUDGET_BEHAVIORS, type OverBudgetBehavior } from '@/lib/expense-config'

/** GET — the resolved GLOBAL expense module config (ADMIN-only; Expense Settings). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const config = await resolveExpenseModuleConfig(prisma, {})
  return NextResponse.json(config)
}

/** PUT — update the GLOBAL expense module config. Body: a partial config patch. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (body.allowOverBudget !== undefined && !OVER_BUDGET_BEHAVIORS.includes(body.allowOverBudget)) {
    return NextResponse.json({ error: `allowOverBudget must be one of ${OVER_BUDGET_BEHAVIORS.join(', ')}` }, { status: 400 })
  }
  if (body.moduleName !== undefined && !String(body.moduleName).trim()) {
    return NextResponse.json({ error: 'Module name cannot be empty' }, { status: 400 })
  }

  const row = await setExpenseModuleConfig(prisma, 'GLOBAL', null, {
    moduleName: body.moduleName !== undefined ? String(body.moduleName).trim() : undefined,
    enabled: body.enabled,
    defaultCurrency: body.defaultCurrency,
    requireReceiptDefault: body.requireReceiptDefault,
    allowMixedPayment: body.allowMixedPayment,
    allowOverBudget: body.allowOverBudget as OverBudgetBehavior | undefined,
    terminology: body.terminology,
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'ExpenseModuleConfig', entityId: row.id, details: 'Updated global expense module config' },
  })
  return NextResponse.json(await resolveExpenseModuleConfig(prisma, {}))
}
