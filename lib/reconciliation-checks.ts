// Plugin-style required-check registry for the Reconciliation Workflow
// Engine. Which checks must be COMPLETE before a stage can close is
// config-driven (ReconciliationRequirement), not hardcoded — a new check
// type is a new row plus a resolver registered here, the stage engine
// (lib/reconciliation-stage.ts) never changes. Decision: CashRecon/BankRecon
// are NOT redesigned — these resolvers only read their existing tables.
import { startOfDay, endOfDay } from 'date-fns'
import { prisma } from '@/lib/prisma'
import type { ReconciliationStage } from '@prisma/client'

export type CheckStatus = 'PENDING' | 'COMPLETE' | 'FAILED' | 'SKIPPED'

export interface CheckOutcome {
  checkType: string
  status: CheckStatus
  detail?: unknown
  sourceModel?: string
  sourceId?: string
}

type CheckResolver = (stage: ReconciliationStage) => Promise<Omit<CheckOutcome, 'checkType'>>

// ─── Default requirement seeding (seed on first read, same convention as
// ensureChartOfAccounts / ensureDefaultStageConfig) ─────────────────────────

const DEFAULT_REQUIREMENTS: { stageKey: string; checkType: string }[] = [
  { stageKey: 'CASHIER_RECON', checkType: 'CASH_RECON' },
  { stageKey: 'CASHIER_RECON', checkType: 'BANK_RECON' },
  { stageKey: 'FINANCE_RECON', checkType: 'PAYMENT_VERIFICATION' },
]

export async function ensureDefaultRequirements() {
  const existing = await prisma.reconciliationRequirement.findMany({
    where: { scope: 'GLOBAL', scopeId: null },
    select: { stageKey: true, checkType: true },
  })
  const existingKeys = new Set(existing.map((r) => `${r.stageKey}:${r.checkType}`))
  // GLOBAL rows have scopeId=null — NULL != NULL in the unique index, so a
  // compound-unique upsert can't target them (same issue/fix as
  // ensureDefaultStageConfig): the `missing` filter above already confirms
  // no row exists, so a plain create is safe here.
  const missing = DEFAULT_REQUIREMENTS.filter((r) => !existingKeys.has(`${r.stageKey}:${r.checkType}`))
  for (const r of missing) {
    await prisma.reconciliationRequirement.create({
      data: { scope: 'GLOBAL', scopeId: null, stageKey: r.stageKey, checkType: r.checkType, isRequired: true },
    })
  }
}

/** Narrowest-scope-wins per checkType — an OUTLET/COMPANY override can add,
 *  or disable (isRequired: false), a GLOBAL default requirement. */
export async function resolveRequiredChecks(stageKey: string, opts: { companyId: string; outletId?: string | null }): Promise<string[]> {
  await ensureDefaultRequirements()
  const priority: { scope: string; scopeId: string | null }[] = []
  if (opts.outletId) priority.push({ scope: 'OUTLET', scopeId: opts.outletId })
  priority.push({ scope: 'COMPANY', scopeId: opts.companyId })
  priority.push({ scope: 'GLOBAL', scopeId: null })

  const rows = await prisma.reconciliationRequirement.findMany({
    where: { stageKey, OR: priority.map((p) => ({ scope: p.scope, scopeId: p.scopeId })) },
  })

  const byCheckType = new Map<string, boolean>()
  const checkTypes = new Set(rows.map((r) => r.checkType))
  for (const checkType of checkTypes) {
    for (const p of priority) {
      const row = rows.find((r) => r.checkType === checkType && r.scope === p.scope && r.scopeId === p.scopeId)
      if (row) {
        byCheckType.set(checkType, row.isRequired)
        break
      }
    }
  }
  return [...byCheckType.entries()].filter(([, required]) => required).map(([checkType]) => checkType)
}

// ─── Check resolvers ────────────────────────────────────────────────────────

const CASH_RECON: CheckResolver = async (stage) => {
  if (!stage.outletId) return { status: 'SKIPPED', detail: 'No outlet — cash recon is an outlet-level check' }
  const range = { gte: startOfDay(stage.date), lte: endOfDay(stage.date) }
  const row = await prisma.cashRecon.findFirst({ where: { outletId: stage.outletId, date: range } })
  if (!row) return { status: 'FAILED', detail: 'No Cash Reconciliation recorded for this outlet/date' }
  if (row.verifiedAmount == null) return { status: 'FAILED', detail: 'Cash Reconciliation recorded but not yet verified', sourceModel: 'CashRecon', sourceId: row.id }
  return { status: 'COMPLETE', sourceModel: 'CashRecon', sourceId: row.id }
}

const BANK_RECON: CheckResolver = async (stage) => {
  if (!stage.outletId) return { status: 'SKIPPED', detail: 'No outlet — bank recon is an outlet-level check' }
  const range = { gte: startOfDay(stage.date), lte: endOfDay(stage.date) }
  const rows = await prisma.bankRecon.findMany({ where: { outletId: stage.outletId, date: range, channel: { not: null } } })
  if (!rows.length) return { status: 'FAILED', detail: 'No Bank/Digital Reconciliation recorded for this outlet/date' }
  const unverified = rows.filter((r) => r.verifiedAmount == null)
  if (unverified.length) {
    return { status: 'FAILED', detail: { unverifiedChannels: unverified.map((r) => r.channel) } }
  }
  return { status: 'COMPLETE', sourceModel: 'BankRecon' }
}

const PAYMENT_VERIFICATION: CheckResolver = async (stage) => {
  const range = { gte: startOfDay(stage.date), lte: endOfDay(stage.date) }
  const rows = await prisma.paymentVerification.findMany({
    where: {
      companyId: stage.companyId,
      date: range,
      ...(stage.outletId ? { outletId: stage.outletId } : {}),
      status: { in: ['PENDING', 'FAILED', 'DUPLICATE'] },
    },
  })
  if (!rows.length) return { status: 'COMPLETE' }
  const byStatus = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {})
  return { status: 'FAILED', detail: { unresolvedPaymentVerifications: byStatus } }
}

export const CHECK_REGISTRY: Record<string, CheckResolver> = {
  CASH_RECON,
  BANK_RECON,
  PAYMENT_VERIFICATION,
}

// ─── Runner ─────────────────────────────────────────────────────────────────

export async function runChecksForStage(stage: ReconciliationStage): Promise<CheckOutcome[]> {
  const requiredChecks = await resolveRequiredChecks(stage.stageKey, { companyId: stage.companyId, outletId: stage.outletId })
  const outcomes: CheckOutcome[] = []

  for (const checkType of requiredChecks) {
    const resolver = CHECK_REGISTRY[checkType]
    const outcome: CheckOutcome = resolver
      ? { checkType, ...(await resolver(stage)) }
      : { checkType, status: 'FAILED', detail: `No resolver registered for check type "${checkType}"` }

    outcomes.push(outcome)
    await prisma.reconciliationCheckResult.upsert({
      where: { stageId_checkType: { stageId: stage.id, checkType } },
      update: {
        status: outcome.status,
        detail: outcome.detail !== undefined ? JSON.stringify(outcome.detail) : null,
        sourceModel: outcome.sourceModel ?? null,
        sourceId: outcome.sourceId ?? null,
        evaluatedAt: new Date(),
      },
      create: {
        stageId: stage.id,
        checkType,
        status: outcome.status,
        detail: outcome.detail !== undefined ? JSON.stringify(outcome.detail) : null,
        sourceModel: outcome.sourceModel ?? null,
        sourceId: outcome.sourceId ?? null,
      },
    })
  }

  return outcomes
}
