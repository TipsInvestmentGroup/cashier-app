import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAuthUser } from '@/lib/auth'
import {
  resolvePayrollConfig,
  setPayrollModuleConfig,
  EXCHANGE_RATE_POLICIES,
  ROUNDING_POLICIES,
  NEGATIVE_NET_POLICIES,
  PAY_VISIBILITY,
  type ExchangeRatePolicy,
  type RoundingPolicy,
  type NegativeNetPolicy,
  type PayVisibility,
} from '@/lib/payroll-config'

/** GET — the resolved GLOBAL payroll module config (ADMIN-only; Payroll Settings).
 *  Falls back to the disabled default when nothing is configured, so a fresh
 *  deployment reads cleanly (enabled = false). */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const config = await resolvePayrollConfig(prisma, {})
  return NextResponse.json(config)
}

/** PUT — update the GLOBAL payroll module config. Body: a partial config patch. */
export async function PUT(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))

  // Validate the enumerated policy fields — an invalid value would otherwise be
  // silently coerced to the fallback on the next read, hiding the mistake.
  const enumChecks: [unknown, readonly string[], string][] = [
    [body.exchangeRatePolicy, EXCHANGE_RATE_POLICIES, 'exchangeRatePolicy'],
    [body.roundingPolicy, ROUNDING_POLICIES, 'roundingPolicy'],
    [body.negativeNetPolicy, NEGATIVE_NET_POLICIES, 'negativeNetPolicy'],
    [body.payElementVisibilityDefault, PAY_VISIBILITY, 'payElementVisibilityDefault'],
  ]
  for (const [value, allowed, field] of enumChecks) {
    if (value !== undefined && !allowed.includes(value as string)) {
      return NextResponse.json({ error: `${field} must be one of ${allowed.join(', ')}` }, { status: 400 })
    }
  }
  if (body.moduleName !== undefined && !String(body.moduleName).trim()) {
    return NextResponse.json({ error: 'Module name cannot be empty' }, { status: 400 })
  }
  if (body.defaultCurrency !== undefined && !String(body.defaultCurrency).trim()) {
    return NextResponse.json({ error: 'Default currency cannot be empty' }, { status: 400 })
  }

  const row = await setPayrollModuleConfig(prisma, 'GLOBAL', null, {
    moduleName: body.moduleName !== undefined ? String(body.moduleName).trim() : undefined,
    enabled: body.enabled,
    defaultCurrency: body.defaultCurrency !== undefined ? String(body.defaultCurrency).trim() : undefined,
    exchangeRatePolicy: body.exchangeRatePolicy as ExchangeRatePolicy | undefined,
    approvalRequiredDefault: body.approvalRequiredDefault,
    roundingPolicy: body.roundingPolicy as RoundingPolicy | undefined,
    negativeNetPolicy: body.negativeNetPolicy as NegativeNetPolicy | undefined,
    payElementVisibilityDefault: body.payElementVisibilityDefault as PayVisibility | undefined,
    terminology: body.terminology,
  })
  await prisma.auditLog.create({
    data: { userId: user.userId, action: 'UPDATE', entity: 'PayrollModuleConfig', entityId: row.id, details: 'Updated global payroll module config' },
  })
  return NextResponse.json(await resolvePayrollConfig(prisma, {}))
}
