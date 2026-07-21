// The Universal Credit Management Framework's resolver — the read-time layer
// that turns the CreditModuleConfig / CreditGroup / CreditAccount records into
// effective values (module identity/terminology, the group for a bill type, an
// account's effective credit limit, and the credit tags to stamp on a new
// SignedBill), without any of it being hardcoded. Mirrors lib/collection-mode.ts
// in shape: narrowest-scope-wins resolution that FALLS BACK to today's exact
// behavior when nothing is configured, so a deployment that never opens Credit
// Settings behaves precisely as before. See prisma/schema.prisma (Credit
// section) and docs/credit-management-framework-design.md.
import type { Db } from '@/lib/ledger'
import { roundMoney } from '@/lib/utils'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'
import { CREDIT_LIMIT_BILL_TYPES } from '@/lib/bill-types'

export const CREDIT_SCOPES = ['GLOBAL', 'COMPANY', 'OUTLET'] as const
export type CreditScope = (typeof CREDIT_SCOPES)[number]

export const OVER_LIMIT_BEHAVIORS = ['BLOCK', 'WARN', 'APPROVE'] as const
export type OverLimitBehavior = (typeof OVER_LIMIT_BEHAVIORS)[number]

// The settlement methods a credit group may allow. PAYROLL_DEDUCTION is only
// meaningful for staff-facing groups; the Payroll module consumes it later.
export const SETTLEMENT_METHODS = ['PAYROLL_DEDUCTION', 'CASH', 'BANK', 'MOBILE_MONEY'] as const
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number]

export interface CreditTerminology {
  module: string
  account: string
  invoice: string
  payment: string
  group: string
}

export interface ResolvedModuleConfig {
  moduleName: string
  enabled: boolean
  defaultCurrency: string
  approvalRequiredDefault: boolean
  allowPartialPayments: boolean
  allowOverLimit: OverLimitBehavior
  requireAttachmentsDefault: boolean
  terminology: CreditTerminology
}

// The hardcoded fallback === today's behavior when no config row exists at any
// scope. Keep in sync with lib/credit-seed.ts's GLOBAL seed.
const DEFAULT_TERMINOLOGY: CreditTerminology = {
  module: 'Signed Bills', account: 'Person', invoice: 'Signed Bill', payment: 'Paid Bill', group: 'Bill Type',
}
const DEFAULT_MODULE_CONFIG: ResolvedModuleConfig = {
  moduleName: 'Signed Bills',
  enabled: true,
  defaultCurrency: 'TZS',
  approvalRequiredDefault: false,
  allowPartialPayments: true,
  allowOverLimit: 'WARN',
  requireAttachmentsDefault: false,
  terminology: DEFAULT_TERMINOLOGY,
}

/** Resolve the company for an outlet, falling back to the default company (same
 *  helper finance-ar uses) so single-company deployments never need an outlet. */
export async function resolveCompanyId(db: Db, outletId?: string | null): Promise<string | null> {
  if (outletId) {
    const outlet = await db.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    if (outlet?.companyId) return outlet.companyId
  }
  return resolveDefaultCompanyId(db)
}

function parseTerminology(raw: string | null | undefined): CreditTerminology {
  if (!raw) return DEFAULT_TERMINOLOGY
  try {
    const parsed = JSON.parse(raw) as Partial<CreditTerminology>
    return { ...DEFAULT_TERMINOLOGY, ...parsed }
  } catch {
    return DEFAULT_TERMINOLOGY
  }
}

/**
 * Resolve the effective credit module config for an outlet, checking narrowest
 * to widest: OUTLET → COMPANY → GLOBAL, falling back to DEFAULT_MODULE_CONFIG
 * (today's behavior) when no row exists. GLOBAL rows carry scopeId = null.
 */
export async function resolveCreditModuleConfig(db: Db, opts: { outletId?: string | null } = {}): Promise<ResolvedModuleConfig> {
  const priority: { scope: CreditScope; scopeId: string | null }[] = []
  let companyId: string | null = null
  if (opts.outletId) {
    const outlet = await db.outlet.findUnique({ where: { id: opts.outletId }, select: { companyId: true } })
    companyId = outlet?.companyId || null
    priority.push({ scope: 'OUTLET', scopeId: opts.outletId })
  }
  if (companyId) priority.push({ scope: 'COMPANY', scopeId: companyId })
  priority.push({ scope: 'GLOBAL', scopeId: null })

  const rows = await db.creditModuleConfig.findMany({
    where: { OR: priority.map((p) => ({ scope: p.scope, scopeId: p.scopeId })) },
  })
  for (const p of priority) {
    const row = rows.find((r) => r.scope === p.scope && r.scopeId === p.scopeId)
    if (row) {
      return {
        moduleName: row.moduleName,
        enabled: row.enabled,
        defaultCurrency: row.defaultCurrency,
        approvalRequiredDefault: row.approvalRequiredDefault,
        allowPartialPayments: row.allowPartialPayments,
        allowOverLimit: (OVER_LIMIT_BEHAVIORS as readonly string[]).includes(row.allowOverLimit) ? (row.allowOverLimit as OverLimitBehavior) : 'WARN',
        requireAttachmentsDefault: row.requireAttachmentsDefault,
        terminology: parseTerminology(row.terminology),
      }
    }
  }
  return DEFAULT_MODULE_CONFIG
}

/** Convenience: just the resolved terminology map for an outlet. */
export async function resolveTerminology(db: Db, outletId?: string | null): Promise<CreditTerminology> {
  return (await resolveCreditModuleConfig(db, { outletId })).terminology
}

// A minimal shape of the fields callers actually read off a resolved group.
export interface ResolvedGroup {
  id: string
  code: string
  name: string
  isCreditBearing: boolean
  requiresApproval: boolean
  maxCredit: number
  paymentTermsDays: number
  gracePeriodDays: number
  defaultSettlementMethod: string
  settlementMethods: string[]
  legacyBillTypeCode: string | null
}

function toResolvedGroup(g: {
  id: string; code: string; name: string; isCreditBearing: boolean; requiresApproval: boolean
  maxCredit: number; paymentTermsDays: number; gracePeriodDays: number; defaultSettlementMethod: string
  settlementMethods: string; legacyBillTypeCode: string | null
}): ResolvedGroup {
  let methods: string[] = []
  try { methods = JSON.parse(g.settlementMethods) } catch { methods = [] }
  return {
    id: g.id, code: g.code, name: g.name, isCreditBearing: g.isCreditBearing, requiresApproval: g.requiresApproval,
    maxCredit: g.maxCredit, paymentTermsDays: g.paymentTermsDays, gracePeriodDays: g.gracePeriodDays,
    defaultSettlementMethod: g.defaultSettlementMethod, settlementMethods: methods, legacyBillTypeCode: g.legacyBillTypeCode,
  }
}

/**
 * The bridge: find the active CreditGroup that classifies a given
 * SignedBill.billType, via legacyBillTypeCode. Returns null when the framework
 * hasn't been seeded (⇒ callers fall back to the fixed lib/bill-types.ts
 * behavior). companyId defaults to the outlet's / default company.
 */
export async function resolveGroupForBillType(db: Db, opts: { billType: string; outletId?: string | null; companyId?: string | null }): Promise<ResolvedGroup | null> {
  const companyId = opts.companyId ?? (await resolveCompanyId(db, opts.outletId))
  if (!companyId) return null
  const g = await db.creditGroup.findFirst({ where: { companyId, legacyBillTypeCode: opts.billType, status: 'ACTIVE' } })
  return g ? toResolvedGroup(g) : null
}

export type LimitSource = 'ACCOUNT_OVERRIDE' | 'GROUP' | 'PERSON' | 'NONE'
export interface EffectiveLimit {
  /** 0 = no limit configured (never blocks). */
  limit: number
  source: LimitSource
}

/**
 * Resolve the effective credit limit for a person buying under a bill type.
 * Priority (most specific wins):
 *   1. CreditAccount.creditLimitOverride  (per-debtor override)
 *   2. CreditGroup.maxCredit              (group ceiling, when > 0)
 *   3. Person.creditLimit                 (ONLY for legacy CREDIT_LIMIT_BILL_TYPES
 *                                          — preserves today's ADMIN/DIRECTOR rule)
 *   4. none                               (0 ⇒ unlimited / no check)
 * Sources 1–2 are purely additive: with the current seed (maxCredit = 0, no
 * overrides) this returns exactly source 3/4, i.e. today's behavior unchanged.
 */
export async function resolveEffectiveLimit(db: Db, opts: { personId?: string | null; billType: string; outletId?: string | null; companyId?: string | null }): Promise<EffectiveLimit> {
  if (!opts.personId) return { limit: 0, source: 'NONE' }

  const [account, group, person] = await Promise.all([
    db.creditAccount.findUnique({ where: { personId: opts.personId }, select: { creditLimitOverride: true } }),
    resolveGroupForBillType(db, { billType: opts.billType, outletId: opts.outletId, companyId: opts.companyId }),
    db.person.findUnique({ where: { id: opts.personId }, select: { creditLimit: true } }),
  ])

  if (account?.creditLimitOverride && account.creditLimitOverride > 0) {
    return { limit: roundMoney(account.creditLimitOverride), source: 'ACCOUNT_OVERRIDE' }
  }
  if (group && group.maxCredit > 0) {
    return { limit: roundMoney(group.maxCredit), source: 'GROUP' }
  }
  const legacyBearsPersonLimit = (CREDIT_LIMIT_BILL_TYPES as readonly string[]).includes(opts.billType)
  if (legacyBearsPersonLimit && person && person.creditLimit > 0) {
    return { limit: roundMoney(person.creditLimit), source: 'PERSON' }
  }
  return { limit: 0, source: 'NONE' }
}

/**
 * Resolve the credit tags (group + account) to stamp on a new SignedBill, so
 * every bill is classified against the framework. Both are best-effort and
 * NULLABLE — a missing group (unseeded) or a name-only bill (no personId) just
 * yields null, never an error.
 */
export async function resolveCreditTags(db: Db, opts: { billType: string; personId?: string | null; outletId?: string | null; companyId?: string | null }): Promise<{ creditGroupId: string | null; creditAccountId: string | null }> {
  const companyId = opts.companyId ?? (await resolveCompanyId(db, opts.outletId))
  const [group, account] = await Promise.all([
    companyId ? db.creditGroup.findFirst({ where: { companyId, legacyBillTypeCode: opts.billType, status: 'ACTIVE' }, select: { id: true } }) : Promise.resolve(null),
    opts.personId ? db.creditAccount.findUnique({ where: { personId: opts.personId }, select: { id: true } }) : Promise.resolve(null),
  ])
  return { creditGroupId: group?.id ?? null, creditAccountId: account?.id ?? null }
}

// The module-config fields an admin may edit. terminology is passed as an object
// and serialized here so callers never touch the JSON encoding.
export interface CreditModuleConfigPatch {
  moduleName?: string
  enabled?: boolean
  defaultCurrency?: string
  approvalRequiredDefault?: boolean
  allowPartialPayments?: boolean
  allowOverLimit?: OverLimitBehavior
  requireAttachmentsDefault?: boolean
  terminology?: Partial<CreditTerminology>
}

/**
 * Upsert one credit-module-config row. GLOBAL rows carry scopeId = null and
 * can't use the DB compound-unique upsert (NULL != NULL), so they're looked up
 * explicitly — same pattern as setCollectionMode. Returns the saved row.
 */
export async function setCreditModuleConfig(db: Db, scope: CreditScope, scopeId: string | null, patch: CreditModuleConfigPatch) {
  const data: Record<string, unknown> = {}
  if (patch.moduleName !== undefined) data.moduleName = patch.moduleName
  if (patch.enabled !== undefined) data.enabled = patch.enabled
  if (patch.defaultCurrency !== undefined) data.defaultCurrency = patch.defaultCurrency
  if (patch.approvalRequiredDefault !== undefined) data.approvalRequiredDefault = patch.approvalRequiredDefault
  if (patch.allowPartialPayments !== undefined) data.allowPartialPayments = patch.allowPartialPayments
  if (patch.allowOverLimit !== undefined) data.allowOverLimit = patch.allowOverLimit
  if (patch.requireAttachmentsDefault !== undefined) data.requireAttachmentsDefault = patch.requireAttachmentsDefault
  if (patch.terminology !== undefined) data.terminology = JSON.stringify({ ...DEFAULT_TERMINOLOGY, ...patch.terminology })

  if (scope === 'GLOBAL') {
    const existing = await db.creditModuleConfig.findFirst({ where: { scope: 'GLOBAL', scopeId: null } })
    if (existing) return db.creditModuleConfig.update({ where: { id: existing.id }, data })
    return db.creditModuleConfig.create({ data: { scope: 'GLOBAL', scopeId: null, ...data } })
  }
  if (!scopeId) throw new Error(`scopeId is required for scope ${scope}`)
  return db.creditModuleConfig.upsert({
    where: { scope_scopeId: { scope, scopeId } },
    update: data,
    create: { scope, scopeId, ...data },
  })
}
