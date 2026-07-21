// The Universal Payroll Framework's read-time resolver — turns the
// PayrollModuleConfig records into effective values (module identity,
// terminology, and the behaviour switches later phases read), without any of it
// being hardcoded. Mirrors lib/credit-config.ts in shape: narrowest-scope-wins
// resolution (OUTLET → COMPANY → GLOBAL) that FALLS BACK to a disabled module
// when nothing is configured, so a deployment that never opens Payroll Settings
// behaves exactly as before (the deduction report keeps working; nothing pays
// anyone). See prisma/schema.prisma (Payroll section) and
// docs/payroll-framework-design.md.
import type { Db } from '@/lib/ledger'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'

export const PAYROLL_SCOPES = ['GLOBAL', 'COMPANY', 'OUTLET'] as const
export type PayrollScope = (typeof PAYROLL_SCOPES)[number]

export const EXCHANGE_RATE_POLICIES = ['RUN_DATE', 'PERIOD_END', 'MANUAL'] as const
export type ExchangeRatePolicy = (typeof EXCHANGE_RATE_POLICIES)[number]

export const ROUNDING_POLICIES = ['NONE', 'NEAREST_0_01', 'NEAREST_1', 'NEAREST_5', 'NEAREST_10'] as const
export type RoundingPolicy = (typeof ROUNDING_POLICIES)[number]

export const NEGATIVE_NET_POLICIES = ['BLOCK', 'CARRY_FORWARD', 'CAP'] as const
export type NegativeNetPolicy = (typeof NEGATIVE_NET_POLICIES)[number]

export const PAY_VISIBILITY = ['SUMMARY', 'FULL', 'MASKED'] as const
export type PayVisibility = (typeof PAY_VISIBILITY)[number]

export interface PayrollTerminology {
  module: string
  employee: string
  payslip: string
  run: string
  earning: string
  deduction: string
}

export interface ResolvedPayrollConfig {
  moduleName: string
  enabled: boolean
  defaultCurrency: string
  exchangeRatePolicy: ExchangeRatePolicy
  approvalRequiredDefault: boolean
  roundingPolicy: RoundingPolicy
  negativeNetPolicy: NegativeNetPolicy
  payElementVisibilityDefault: PayVisibility
  terminology: PayrollTerminology
}

// The hardcoded fallback === "module off, nothing paid" when no config row
// exists at any scope. Keep in sync with lib/payroll-seed.ts's GLOBAL seed.
const DEFAULT_TERMINOLOGY: PayrollTerminology = {
  module: 'Payroll', employee: 'Employee', payslip: 'Payslip', run: 'Pay Run', earning: 'Earning', deduction: 'Deduction',
}
const DEFAULT_PAYROLL_CONFIG: ResolvedPayrollConfig = {
  moduleName: 'Payroll',
  enabled: false, // installing the framework changes nothing until an admin enables it
  defaultCurrency: 'TZS',
  exchangeRatePolicy: 'RUN_DATE',
  approvalRequiredDefault: true,
  roundingPolicy: 'NEAREST_1',
  negativeNetPolicy: 'CARRY_FORWARD',
  payElementVisibilityDefault: 'SUMMARY',
  terminology: DEFAULT_TERMINOLOGY,
}

/** Resolve the company for an outlet, falling back to the default company (same
 *  helper credit/finance use) so single-company deployments never need an outlet. */
export async function resolveCompanyId(db: Db, outletId?: string | null): Promise<string | null> {
  if (outletId) {
    const outlet = await db.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    if (outlet?.companyId) return outlet.companyId
  }
  return resolveDefaultCompanyId(db)
}

function parseTerminology(raw: string | null | undefined): PayrollTerminology {
  if (!raw) return DEFAULT_TERMINOLOGY
  try {
    const parsed = JSON.parse(raw) as Partial<PayrollTerminology>
    return { ...DEFAULT_TERMINOLOGY, ...parsed }
  } catch {
    return DEFAULT_TERMINOLOGY
  }
}

function oneOf<T extends string>(values: readonly T[], raw: string, fallback: T): T {
  return (values as readonly string[]).includes(raw) ? (raw as T) : fallback
}

/**
 * Resolve the effective payroll module config for an outlet, checking narrowest
 * to widest: OUTLET → COMPANY → GLOBAL, falling back to DEFAULT_PAYROLL_CONFIG
 * (module disabled) when no row exists. GLOBAL rows carry scopeId = null.
 */
export async function resolvePayrollConfig(db: Db, opts: { outletId?: string | null } = {}): Promise<ResolvedPayrollConfig> {
  const priority: { scope: PayrollScope; scopeId: string | null }[] = []
  let companyId: string | null = null
  if (opts.outletId) {
    const outlet = await db.outlet.findUnique({ where: { id: opts.outletId }, select: { companyId: true } })
    companyId = outlet?.companyId || null
    priority.push({ scope: 'OUTLET', scopeId: opts.outletId })
  }
  if (companyId) priority.push({ scope: 'COMPANY', scopeId: companyId })
  priority.push({ scope: 'GLOBAL', scopeId: null })

  const rows = await db.payrollModuleConfig.findMany({
    where: { OR: priority.map((p) => ({ scope: p.scope, scopeId: p.scopeId })) },
  })
  for (const p of priority) {
    const row = rows.find((r) => r.scope === p.scope && r.scopeId === p.scopeId)
    if (row) {
      return {
        moduleName: row.moduleName,
        enabled: row.enabled,
        defaultCurrency: row.defaultCurrency,
        exchangeRatePolicy: oneOf(EXCHANGE_RATE_POLICIES, row.exchangeRatePolicy, 'RUN_DATE'),
        approvalRequiredDefault: row.approvalRequiredDefault,
        roundingPolicy: oneOf(ROUNDING_POLICIES, row.roundingPolicy, 'NEAREST_1'),
        negativeNetPolicy: oneOf(NEGATIVE_NET_POLICIES, row.negativeNetPolicy, 'CARRY_FORWARD'),
        payElementVisibilityDefault: oneOf(PAY_VISIBILITY, row.payElementVisibilityDefault, 'SUMMARY'),
        terminology: parseTerminology(row.terminology),
      }
    }
  }
  return DEFAULT_PAYROLL_CONFIG
}

/** Convenience: is the payroll module enabled for this outlet? Everything the
 *  module does must gate on this — false ⇒ today's deduction-report behaviour. */
export async function isPayrollEnabled(db: Db, outletId?: string | null): Promise<boolean> {
  return (await resolvePayrollConfig(db, { outletId })).enabled
}

/** Convenience: just the resolved terminology map for an outlet. */
export async function resolvePayrollTerminology(db: Db, outletId?: string | null): Promise<PayrollTerminology> {
  return (await resolvePayrollConfig(db, { outletId })).terminology
}

// The module-config fields an admin may edit. terminology is passed as an object
// and serialized here so callers never touch the JSON encoding.
export interface PayrollModuleConfigPatch {
  moduleName?: string
  enabled?: boolean
  defaultCurrency?: string
  exchangeRatePolicy?: ExchangeRatePolicy
  approvalRequiredDefault?: boolean
  roundingPolicy?: RoundingPolicy
  negativeNetPolicy?: NegativeNetPolicy
  payElementVisibilityDefault?: PayVisibility
  terminology?: Partial<PayrollTerminology>
}

/**
 * Upsert one payroll-module-config row. GLOBAL rows carry scopeId = null and
 * can't use the DB compound-unique upsert (NULL != NULL on SQLite), so they're
 * looked up explicitly — same pattern as setCreditModuleConfig / setCollectionMode.
 * Returns the saved row.
 */
export async function setPayrollModuleConfig(db: Db, scope: PayrollScope, scopeId: string | null, patch: PayrollModuleConfigPatch) {
  const data: Record<string, unknown> = {}
  if (patch.moduleName !== undefined) data.moduleName = patch.moduleName
  if (patch.enabled !== undefined) data.enabled = patch.enabled
  if (patch.defaultCurrency !== undefined) data.defaultCurrency = patch.defaultCurrency
  if (patch.exchangeRatePolicy !== undefined) data.exchangeRatePolicy = patch.exchangeRatePolicy
  if (patch.approvalRequiredDefault !== undefined) data.approvalRequiredDefault = patch.approvalRequiredDefault
  if (patch.roundingPolicy !== undefined) data.roundingPolicy = patch.roundingPolicy
  if (patch.negativeNetPolicy !== undefined) data.negativeNetPolicy = patch.negativeNetPolicy
  if (patch.payElementVisibilityDefault !== undefined) data.payElementVisibilityDefault = patch.payElementVisibilityDefault
  if (patch.terminology !== undefined) data.terminology = JSON.stringify({ ...DEFAULT_TERMINOLOGY, ...patch.terminology })

  if (scope === 'GLOBAL') {
    const existing = await db.payrollModuleConfig.findFirst({ where: { scope: 'GLOBAL', scopeId: null } })
    if (existing) return db.payrollModuleConfig.update({ where: { id: existing.id }, data })
    return db.payrollModuleConfig.create({ data: { scope: 'GLOBAL', scopeId: null, ...data } })
  }
  if (!scopeId) throw new Error(`scopeId is required for scope ${scope}`)
  return db.payrollModuleConfig.upsert({
    where: { scope_scopeId: { scope, scopeId } },
    update: data,
    create: { scope, scopeId, ...data },
  })
}
