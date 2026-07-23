// The Universal Expense & Disbursement Framework's resolver — the read-time
// layer that turns ExpenseModuleConfig records into effective values (module
// identity/terminology, behavior switches), without any of it being
// hardcoded. Mirrors lib/credit-config.ts in shape: narrowest-scope-wins
// resolution that FALLS BACK to a sensible default when nothing is
// configured, so a deployment that never opens Expense Settings still works.
// See prisma/schema.prisma (Expense & Disbursement section) and
// docs/expense-disbursement-framework-design.md.
import type { Db } from '@/lib/ledger'
import { resolveDefaultCompanyId } from '@/lib/finance-mapping'

export const EXPENSE_SCOPES = ['GLOBAL', 'COMPANY', 'OUTLET'] as const
export type ExpenseScope = (typeof EXPENSE_SCOPES)[number]

export const OVER_BUDGET_BEHAVIORS = ['BLOCK', 'WARN', 'APPROVE'] as const
export type OverBudgetBehavior = (typeof OVER_BUDGET_BEHAVIORS)[number]

export const FUNDING_SOURCE_TYPES = ['CASH', 'BANK', 'MOBILE_MONEY', 'CARD', 'OTHER'] as const
export type FundingSourceType = (typeof FUNDING_SOURCE_TYPES)[number]

export const BUDGET_VALIDATION_MODES = ['NONE', 'WARN', 'BLOCK'] as const
export type BudgetValidationMode = (typeof BUDGET_VALIDATION_MODES)[number]

export const EXPENSE_REQUEST_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PARTIALLY_PAID', 'PAID', 'VERIFIED', 'CLOSED', 'CANCELLED',
] as const
export type ExpenseRequestStatus = (typeof EXPENSE_REQUEST_STATUSES)[number]

export const VERIFICATION_STAGES = ['RECEIPT_UPLOADED', 'RECEIPT_VERIFIED', 'GOODS_CONFIRMED', 'VALIDATED'] as const
export type VerificationStage = (typeof VERIFICATION_STAGES)[number]

export const ATTACHMENT_DOC_TYPES = ['RECEIPT', 'INVOICE', 'PROOF_OF_PAYMENT', 'SCREENSHOT', 'OTHER'] as const
export type AttachmentDocType = (typeof ATTACHMENT_DOC_TYPES)[number]

export const ATTACHMENT_ENTITY_TYPES = ['ExpenseRequest', 'ExpensePayment', 'VerificationRecord'] as const
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number]

export interface ExpenseTerminology {
  module: string
  requestType: string
  category: string
  fundingSource: string
  request: string
}

export interface ResolvedExpenseModuleConfig {
  moduleName: string
  enabled: boolean
  defaultCurrency: string
  requireReceiptDefault: boolean
  allowMixedPayment: boolean
  allowOverBudget: OverBudgetBehavior
  terminology: ExpenseTerminology
}

// The hardcoded fallback === a sensible default when no config row exists at
// any scope (today's PettyCash flow keeps working regardless — this fallback
// only shapes the NEW engine's own screens). Keep in sync with
// lib/expense-seed.ts's GLOBAL seed.
const DEFAULT_TERMINOLOGY: ExpenseTerminology = {
  module: 'Petty Cash', requestType: 'Request Type', category: 'Function', fundingSource: 'Fund', request: 'Petty Cash Request',
}
const DEFAULT_MODULE_CONFIG: ResolvedExpenseModuleConfig = {
  moduleName: 'Petty Cash',
  enabled: true,
  defaultCurrency: 'TZS',
  requireReceiptDefault: true,
  allowMixedPayment: true,
  allowOverBudget: 'WARN',
  terminology: DEFAULT_TERMINOLOGY,
}

/** Resolve the company for an outlet, falling back to the default company —
 *  same helper used by lib/credit-config.ts — so single-company deployments
 *  never need an outlet. */
export async function resolveCompanyId(db: Db, outletId?: string | null): Promise<string | null> {
  if (outletId) {
    const outlet = await db.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    if (outlet?.companyId) return outlet.companyId
  }
  return resolveDefaultCompanyId(db)
}

function parseTerminology(raw: string | null | undefined): ExpenseTerminology {
  if (!raw) return DEFAULT_TERMINOLOGY
  try {
    const parsed = JSON.parse(raw) as Partial<ExpenseTerminology>
    return { ...DEFAULT_TERMINOLOGY, ...parsed }
  } catch {
    return DEFAULT_TERMINOLOGY
  }
}

/**
 * Resolve the effective expense module config for an outlet, checking
 * narrowest to widest: OUTLET → COMPANY → GLOBAL, falling back to
 * DEFAULT_MODULE_CONFIG when no row exists. GLOBAL rows carry scopeId = null.
 */
export async function resolveExpenseModuleConfig(db: Db, opts: { outletId?: string | null } = {}): Promise<ResolvedExpenseModuleConfig> {
  const priority: { scope: ExpenseScope; scopeId: string | null }[] = []
  let companyId: string | null = null
  if (opts.outletId) {
    const outlet = await db.outlet.findUnique({ where: { id: opts.outletId }, select: { companyId: true } })
    companyId = outlet?.companyId || null
    priority.push({ scope: 'OUTLET', scopeId: opts.outletId })
  }
  if (companyId) priority.push({ scope: 'COMPANY', scopeId: companyId })
  priority.push({ scope: 'GLOBAL', scopeId: null })

  const rows = await db.expenseModuleConfig.findMany({
    where: { OR: priority.map((p) => ({ scope: p.scope, scopeId: p.scopeId })) },
  })
  for (const p of priority) {
    const row = rows.find((r) => r.scope === p.scope && r.scopeId === p.scopeId)
    if (row) {
      return {
        moduleName: row.moduleName,
        enabled: row.enabled,
        defaultCurrency: row.defaultCurrency,
        requireReceiptDefault: row.requireReceiptDefault,
        allowMixedPayment: row.allowMixedPayment,
        allowOverBudget: (OVER_BUDGET_BEHAVIORS as readonly string[]).includes(row.allowOverBudget) ? (row.allowOverBudget as OverBudgetBehavior) : 'WARN',
        terminology: parseTerminology(row.terminology),
      }
    }
  }
  return DEFAULT_MODULE_CONFIG
}

/** Convenience: just the resolved terminology map for an outlet. */
export async function resolveExpenseTerminology(db: Db, outletId?: string | null): Promise<ExpenseTerminology> {
  return (await resolveExpenseModuleConfig(db, { outletId })).terminology
}

// The module-config fields an admin may edit. terminology is passed as an
// object and serialized here so callers never touch the JSON encoding.
export interface ExpenseModuleConfigPatch {
  moduleName?: string
  enabled?: boolean
  defaultCurrency?: string
  requireReceiptDefault?: boolean
  allowMixedPayment?: boolean
  allowOverBudget?: OverBudgetBehavior
  terminology?: Partial<ExpenseTerminology>
}

/**
 * Upsert one expense-module-config row. GLOBAL rows carry scopeId = null and
 * can't use the DB compound-unique upsert (NULL != NULL), so they're looked
 * up explicitly — same pattern as setCreditModuleConfig. Returns the saved row.
 */
export async function setExpenseModuleConfig(db: Db, scope: ExpenseScope, scopeId: string | null, patch: ExpenseModuleConfigPatch) {
  const data: Record<string, unknown> = {}
  if (patch.moduleName !== undefined) data.moduleName = patch.moduleName
  if (patch.enabled !== undefined) data.enabled = patch.enabled
  if (patch.defaultCurrency !== undefined) data.defaultCurrency = patch.defaultCurrency
  if (patch.requireReceiptDefault !== undefined) data.requireReceiptDefault = patch.requireReceiptDefault
  if (patch.allowMixedPayment !== undefined) data.allowMixedPayment = patch.allowMixedPayment
  if (patch.allowOverBudget !== undefined) data.allowOverBudget = patch.allowOverBudget
  if (patch.terminology !== undefined) data.terminology = JSON.stringify({ ...DEFAULT_TERMINOLOGY, ...patch.terminology })

  if (scope === 'GLOBAL') {
    const existing = await db.expenseModuleConfig.findFirst({ where: { scope: 'GLOBAL', scopeId: null } })
    if (existing) return db.expenseModuleConfig.update({ where: { id: existing.id }, data })
    return db.expenseModuleConfig.create({ data: { scope: 'GLOBAL', scopeId: null, ...data } })
  }
  if (!scopeId) throw new Error(`scopeId is required for scope ${scope}`)
  return db.expenseModuleConfig.upsert({
    where: { scope_scopeId: { scope, scopeId } },
    update: data,
    create: { scope, scopeId, ...data },
  })
}
