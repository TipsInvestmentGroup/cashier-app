// Configurable reminder/escalation cadence resolver for the Reconciliation
// Workflow Engine. Same GLOBAL->COMPANY->OUTLET scope shape as every other
// config table here, additionally narrowed by an optional stageKey (a row
// with stageKey=null applies to every stage at that scope). No seeding
// needed — the schema column defaults already match the brief's example
// cadence (30 min / 2 hours / end of window), so "no row anywhere" already
// behaves exactly like that default, same zero-setup convention as
// BusinessDayPolicyConfig.
import { prisma } from '@/lib/prisma'
import type { StageKey } from '@/lib/reconciliation-stage'

export interface ReminderPolicy {
  reminderAnchor: string
  firstReminderMinutes: number
  secondReminderMinutes: number
  escalationAtEndOfWindow: boolean
  generateExceptionReport: boolean
}

const HARDCODED_DEFAULT: ReminderPolicy = {
  reminderAnchor: 'STAGE_OPEN',
  firstReminderMinutes: 30,
  secondReminderMinutes: 120,
  escalationAtEndOfWindow: true,
  generateExceptionReport: true,
}

export async function resolveReminderPolicy(stageKey: StageKey, opts: { companyId: string; outletId?: string | null }): Promise<ReminderPolicy> {
  const priority: { scope: string; scopeId: string | null }[] = []
  if (opts.outletId) priority.push({ scope: 'OUTLET', scopeId: opts.outletId })
  priority.push({ scope: 'COMPANY', scopeId: opts.companyId })
  priority.push({ scope: 'GLOBAL', scopeId: null })

  const rows = await prisma.reconciliationReminderPolicy.findMany({
    where: { OR: priority.map((p) => ({ scope: p.scope, scopeId: p.scopeId })) },
  })

  // Narrowest scope wins; within a scope, a stage-specific row (stageKey set)
  // wins over that scope's catch-all (stageKey: null) row.
  for (const p of priority) {
    const specific = rows.find((r) => r.scope === p.scope && r.scopeId === p.scopeId && r.stageKey === stageKey)
    if (specific) return specific
    const catchAll = rows.find((r) => r.scope === p.scope && r.scopeId === p.scopeId && r.stageKey === null)
    if (catchAll) return catchAll
  }
  return HARDCODED_DEFAULT
}

/** Admin CRUD helper — upsert one reminder policy override. */
export async function setReminderPolicy(opts: {
  scope: 'GLOBAL' | 'COMPANY' | 'OUTLET'
  scopeId: string | null
  stageKey: StageKey | null
  reminderAnchor?: string
  firstReminderMinutes?: number
  secondReminderMinutes?: number
  escalationAtEndOfWindow?: boolean
  generateExceptionReport?: boolean
}) {
  const data = {
    reminderAnchor: opts.reminderAnchor,
    firstReminderMinutes: opts.firstReminderMinutes,
    secondReminderMinutes: opts.secondReminderMinutes,
    escalationAtEndOfWindow: opts.escalationAtEndOfWindow,
    generateExceptionReport: opts.generateExceptionReport,
  }
  // scopeId and/or stageKey can be null (GLOBAL scope, or a scope-wide
  // catch-all row) — NULL != NULL in the unique index, so a compound-unique
  // upsert can't target those rows (same issue as ensureDefaultStageConfig).
  // findFirst + create/update instead.
  const existing = await prisma.reconciliationReminderPolicy.findFirst({
    where: { scope: opts.scope, scopeId: opts.scopeId, stageKey: opts.stageKey },
  })
  if (existing) {
    return prisma.reconciliationReminderPolicy.update({ where: { id: existing.id }, data })
  }
  return prisma.reconciliationReminderPolicy.create({ data: { scope: opts.scope, scopeId: opts.scopeId, stageKey: opts.stageKey, ...data } })
}

/**
 * Exception report (§12.2.1 of the design doc) — a read-model over stages
 * that reached full escalation and are still not resolved, joined with their
 * failing checks. Not a stored table; generated on demand from data that
 * already exists.
 */
export async function getExceptionReport(opts: { companyId?: string; outletId?: string | null; date?: Date }) {
  const stages = await prisma.reconciliationStage.findMany({
    where: {
      status: { in: ['INCOMPLETE', 'OPEN'] },
      escalatedAt: { not: null },
      ...(opts.companyId ? { companyId: opts.companyId } : {}),
      ...(opts.outletId !== undefined ? { outletId: opts.outletId } : {}),
      ...(opts.date ? { date: opts.date } : {}),
    },
    include: { checkResults: { where: { status: { in: ['FAILED', 'PENDING'] } } } },
    orderBy: { escalatedAt: 'desc' },
  })
  return stages
}
