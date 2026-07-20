// Reconciliation Workflow Engine — core stage state machine.
// Generalizes BusinessDay into 5 independently configurable stages:
//   BUSINESS_DAY -> CASHIER_RECON -> FINANCE_RECON -> FINANCIAL_CLOSE -> ARCHIVED
// BusinessDay itself is untouched — closing the BUSINESS_DAY stage writes
// through to lib/business-day.ts so every existing screen/report keeps
// working, while also creating the generalized ReconciliationStage row the
// later stages key off of. See docs/reconciliation-workflow-engine-design.md
// for the full design and the decisions this implements.
import { startOfDay, addMinutes } from 'date-fns'
import { prisma } from '@/lib/prisma'
import { notifyResourceHoldersMultiChannel } from '@/lib/notifications'
import { RECONCILIATION_STAGE_RESOURCES, type ReconciliationStageResource } from '@/lib/rbac'
import { closeBusinessDay, reopenBusinessDay as reopenBusinessDayCore } from '@/lib/business-day'
import { runChecksForStage } from '@/lib/reconciliation-checks'

export const STAGE_ORDER = ['BUSINESS_DAY', 'CASHIER_RECON', 'FINANCE_RECON', 'FINANCIAL_CLOSE', 'ARCHIVED'] as const
export type StageKey = (typeof STAGE_ORDER)[number]

// BUSINESS_DAY and CASHIER_RECON are always per-outlet. FINANCE_RECON and
// FINANCIAL_CLOSE default to company-wide (outletId null) unless a company
// explicitly configures an OUTLET-scope override for that stageKey (see
// resolvesToOutletGrain below).
const OUTLET_ONLY_STAGES: StageKey[] = ['BUSINESS_DAY', 'CASHIER_RECON']

export interface Actor {
  userId: string
  userName: string
}

const DURATION_MINUTES: Record<string, number> = { '15m': 15, '30m': 30, '1h': 60 }

export function resolveDurationMinutes(requestedDuration?: string | null, requestedMinutes?: number | null): number {
  if (requestedDuration === 'CUSTOM') return Math.max(1, requestedMinutes || 30)
  return DURATION_MINUTES[requestedDuration || '30m'] ?? 30
}

// ─── Config resolution (GLOBAL -> COMPANY -> OUTLET, narrowest wins) ───────

const HARDCODED_DEFAULT_CONFIG = {
  startTime: null as string | null,
  endTime: null as string | null,
  closeMode: 'MANUAL',
  requiredRoles: null as string | null,
  validationStrictness: 'BLOCK_ON_MISSING',
  graceMinutes: 0,
  isEnabled: true,
  forceAutoClose: false,
  escalationRoles: null as string | null,
  notifyChannels: '["IN_APP"]',
}

/** Seeds the GLOBAL default row for each stage on first read (same
 *  "seed on first read" convention as ensureChartOfAccounts). BUSINESS_DAY
 *  ships enabled (it already is, via BusinessDay today); CASHIER_RECON /
 *  FINANCE_RECON / FINANCIAL_CLOSE ship disabled — every company keeps
 *  today's single-stage behavior until it explicitly opts in. Cheap no-op
 *  once seeded. */
export async function ensureDefaultStageConfig() {
  const existing = await prisma.reconciliationStageConfig.findMany({
    where: { scope: 'GLOBAL', scopeId: null },
    select: { stageKey: true },
  })
  const existingKeys = new Set(existing.map((r) => r.stageKey))
  const missing = STAGE_ORDER.filter((k) => k !== 'ARCHIVED' && !existingKeys.has(k))
  // GLOBAL rows have scopeId=null — NULL != NULL in the unique index, so a
  // compound-unique upsert can't target them; the `missing` filter above
  // already confirms no row exists, so a plain create is safe here (same
  // "findFirst first, since NULL breaks the unique lookup" pattern
  // lib/business-calendar.ts's setBusinessCalendarConfig uses for GLOBAL).
  for (const stageKey of missing) {
    await prisma.reconciliationStageConfig.create({
      data: { scope: 'GLOBAL', scopeId: null, stageKey, isEnabled: stageKey === 'BUSINESS_DAY' },
    })
  }
}

export async function resolveStageConfig(stageKey: StageKey, opts: { companyId: string; outletId?: string | null }) {
  await ensureDefaultStageConfig()
  const priority: { scope: string; scopeId: string | null }[] = []
  if (opts.outletId) priority.push({ scope: 'OUTLET', scopeId: opts.outletId })
  priority.push({ scope: 'COMPANY', scopeId: opts.companyId })
  priority.push({ scope: 'GLOBAL', scopeId: null })

  const rows = await prisma.reconciliationStageConfig.findMany({
    where: { stageKey, OR: priority.map((p) => ({ scope: p.scope, scopeId: p.scopeId })) },
  })
  for (const p of priority) {
    const row = rows.find((r) => r.scope === p.scope && r.scopeId === p.scopeId)
    if (row) return row
  }
  return { ...HARDCODED_DEFAULT_CONFIG, id: '', stageKey, scope: 'GLOBAL', scopeId: null, createdAt: new Date(), updatedAt: new Date() }
}

/** Whether FINANCE_RECON/FINANCIAL_CLOSE should be tracked per-outlet for
 *  this specific outlet (an explicit OUTLET-scope config row exists) rather
 *  than company-wide. BUSINESS_DAY/CASHIER_RECON are always per-outlet. */
export async function resolvesToOutletGrain(stageKey: StageKey, outletId: string): Promise<boolean> {
  if (OUTLET_ONLY_STAGES.includes(stageKey)) return true
  const row = await prisma.reconciliationStageConfig.findUnique({
    where: { scope_scopeId_stageKey: { scope: 'OUTLET', scopeId: outletId, stageKey } },
  })
  return !!row
}

// ─── Core lookups ───────────────────────────────────────────────────────────

export async function getOrCreateStage(opts: { companyId: string; outletId?: string | null; date: Date; stageKey: StageKey }) {
  const day = startOfDay(opts.date)
  const outletId = opts.outletId ?? null
  // outletId is null for company-wide stages — NULL != NULL in the unique
  // index, so a compound-unique upsert can't target those rows; findFirst +
  // create instead (same pattern as ensureDefaultStageConfig above).
  const existing = await prisma.reconciliationStage.findFirst({ where: { companyId: opts.companyId, outletId, date: day, stageKey: opts.stageKey } })
  if (existing) return existing
  return prisma.reconciliationStage.create({ data: { companyId: opts.companyId, outletId, date: day, stageKey: opts.stageKey, status: 'PENDING' } })
}

async function writeAuditLog(stageId: string, entry: {
  action: string
  field?: string
  previousValue?: string
  newValue?: string
  reason?: string
  approvedById?: string
  approvedByName?: string
  userId?: string
  userName?: string
}) {
  return prisma.reconciliationStageAuditLog.create({ data: { stageId, ...entry } })
}

// ─── Gate: is the prerequisite stage closed? ───────────────────────────────

async function assertPrerequisiteClosed(opts: { companyId: string; outletId: string | null; date: Date; stageKey: StageKey }) {
  const idx = STAGE_ORDER.indexOf(opts.stageKey)
  if (idx <= 0) return // BUSINESS_DAY has no prerequisite

  const prevKey = STAGE_ORDER[idx - 1]
  const day = startOfDay(opts.date)

  if (opts.stageKey === 'CASHIER_RECON') {
    // Prerequisite is this same outlet's BUSINESS_DAY.
    const prev = await prisma.reconciliationStage.findFirst({
      where: { companyId: opts.companyId, outletId: opts.outletId, date: day, stageKey: 'BUSINESS_DAY' },
    })
    if (prev && prev.status !== 'CLOSED' && prev.status !== 'ARCHIVED') {
      throw new Error(`Cannot open CASHIER_RECON — BUSINESS_DAY is not closed yet for this outlet/date`)
    }
    return
  }

  if (opts.stageKey === 'FINANCE_RECON' && opts.outletId === null) {
    // Company-wide grain: every outlet's CASHIER_RECON for this company+date
    // must be CLOSED/SKIPPED/ARCHIVED (an outlet with no CASHIER_RECON row at
    // all — e.g. it never operated that day — does not block).
    const outlets = await prisma.outlet.findMany({ where: { companyId: opts.companyId }, select: { id: true } })
    const stages = await prisma.reconciliationStage.findMany({
      where: { companyId: opts.companyId, date: day, stageKey: 'CASHIER_RECON', outletId: { in: outlets.map((o) => o.id) } },
    })
    const unclosed = stages.filter((s) => !['CLOSED', 'ARCHIVED'].includes(s.status))
    if (unclosed.length) {
      throw new Error(`Cannot open FINANCE_RECON — ${unclosed.length} outlet(s) still have an open Cashier Reconciliation for this date`)
    }
    return
  }

  // FINANCE_RECON (outlet-scope override), FINANCIAL_CLOSE, ARCHIVED: same
  // grain as the current stage, prerequisite is the previous stage in order.
  const prev = await prisma.reconciliationStage.findFirst({
    where: { companyId: opts.companyId, outletId: opts.outletId, date: day, stageKey: prevKey },
  })
  if (prev && prev.status !== 'CLOSED' && prev.status !== 'ARCHIVED') {
    throw new Error(`Cannot open ${opts.stageKey} — ${prevKey} is not closed yet`)
  }
}

// ─── Open ───────────────────────────────────────────────────────────────────

export async function openStage(opts: { companyId: string; outletId?: string | null; date: Date; stageKey: StageKey; actor: Actor }) {
  const grainOutletId = OUTLET_ONLY_STAGES.includes(opts.stageKey)
    ? opts.outletId ?? null
    : opts.outletId && (await resolvesToOutletGrain(opts.stageKey, opts.outletId))
      ? opts.outletId
      : null

  const config = await resolveStageConfig(opts.stageKey, { companyId: opts.companyId, outletId: grainOutletId })
  const stage = await getOrCreateStage({ companyId: opts.companyId, outletId: grainOutletId, date: opts.date, stageKey: opts.stageKey })

  if (stage.status !== 'PENDING') return stage // already opened/closed — idempotent

  if (!config.isEnabled) {
    const updated = await prisma.reconciliationStage.update({
      where: { id: stage.id },
      data: { status: 'CLOSED', result: 'SKIPPED', closedAt: new Date() },
    })
    await writeAuditLog(stage.id, { action: 'CLOSE', reason: 'Stage disabled by config — skipped', userId: opts.actor.userId, userName: opts.actor.userName })
    return updated
  }

  await assertPrerequisiteClosed({ companyId: opts.companyId, outletId: grainOutletId, date: opts.date, stageKey: opts.stageKey })

  const graceMinutes = config.graceMinutes ?? 0
  const gracePeriodEndsAt = config.endTime ? addMinutes(startOfDay(opts.date), graceMinutes) : null

  const updated = await prisma.reconciliationStage.update({
    where: { id: stage.id },
    data: { status: 'OPEN', openedAt: new Date(), gracePeriodEndsAt, lastReminderTier: 0, escalatedAt: null },
  })
  await writeAuditLog(stage.id, { action: 'OPEN', userId: opts.actor.userId, userName: opts.actor.userName })
  return updated
}

// ─── Close validation ───────────────────────────────────────────────────────

export async function runCloseValidation(stageId: string) {
  const stage = await prisma.reconciliationStage.findUnique({ where: { id: stageId } })
  if (!stage) throw new Error('Stage not found')
  const results = await runChecksForStage(stage)
  const failing = results.filter((r) => r.status === 'FAILED' || r.status === 'PENDING')
  return { isComplete: failing.length === 0, results, failing }
}

// ─── Close / Reopen ─────────────────────────────────────────────────────────

export async function closeStage(opts: { stageId: string; actor: Actor; allowIncomplete?: boolean }) {
  const stage = await prisma.reconciliationStage.findUnique({ where: { id: opts.stageId } })
  if (!stage) throw new Error('Stage not found')
  const config = await resolveStageConfig(stage.stageKey as StageKey, { companyId: stage.companyId, outletId: stage.outletId })

  const { isComplete, failing } = await runCloseValidation(stage.id)

  if (!isComplete && config.validationStrictness === 'BLOCK_ON_MISSING' && !opts.allowIncomplete) {
    await prisma.reconciliationStage.update({ where: { id: stage.id }, data: { status: 'INCOMPLETE' } })
    await notifyResourceHoldersMultiChannel(
      resourceForStage(stage.stageKey as StageKey),
      stage.outletId,
      {
        type: 'RECONCILIATION_REMINDER',
        title: `${labelForStage(stage.stageKey as StageKey)} incomplete`,
        message: `${failing.length} required check(s) still pending — this stage cannot close yet.`,
        entityType: 'ReconciliationStage',
        entityId: stage.id,
      },
      { sendEmail: false }
    )
    return { blocked: true as const, failing }
  }

  // BUSINESS_DAY writes through to the existing BusinessDay lifecycle so
  // every current screen/report/API keeps working unchanged. If the
  // underlying BusinessDay refuses to close (missing data + blockCloseOnMissing),
  // the ReconciliationStage row must stay open too — otherwise CASHIER_RECON
  // would be allowed to open against a BusinessDay that's still incomplete.
  if (stage.stageKey === 'BUSINESS_DAY' && stage.outletId) {
    const bdResult = await closeBusinessDay({ outletId: stage.outletId, date: stage.date, actor: opts.actor, allowIncomplete: opts.allowIncomplete })
    if (bdResult.blocked) {
      await prisma.reconciliationStage.update({ where: { id: stage.id }, data: { status: 'INCOMPLETE' } })
      return { blocked: true as const, failing: bdResult.missingItems.map((item) => ({ checkType: 'BUSINESS_DAY_DATA', status: 'FAILED' as const, detail: item })) }
    }
  }

  const updated = await prisma.reconciliationStage.update({
    where: { id: stage.id },
    data: {
      status: 'CLOSED',
      result: isComplete ? 'MATCHED' : 'MISSING_TRANSACTION',
      resultDetail: isComplete ? null : JSON.stringify(failing),
      closedById: opts.actor.userId,
      closedByName: opts.actor.userName,
      closedAt: new Date(),
    },
  })
  await writeAuditLog(stage.id, {
    action: 'CLOSE',
    reason: isComplete ? undefined : 'Closed with unresolved checks (override)',
    userId: opts.actor.userId,
    userName: opts.actor.userName,
  })
  return { blocked: false as const, stage: updated }
}

export async function reopenStage(opts: { stageId: string; actor: Actor; reason: string; durationMinutes?: number | null }) {
  const stage = await prisma.reconciliationStage.findUnique({ where: { id: opts.stageId } })
  if (!stage) throw new Error('Stage not found')

  if (stage.stageKey === 'BUSINESS_DAY' && stage.outletId) {
    await reopenBusinessDayCore({ outletId: stage.outletId, date: stage.date, actor: opts.actor, reason: opts.reason, durationMinutes: opts.durationMinutes ?? null })
  }

  const updated = await prisma.reconciliationStage.update({
    where: { id: stage.id },
    data: { status: 'REOPENED', closedAt: null },
  })
  await writeAuditLog(stage.id, { action: 'REOPEN', reason: opts.reason, userId: opts.actor.userId, userName: opts.actor.userName })

  await notifyResourceHoldersMultiChannel(
    RECONCILIATION_STAGE_RESOURCES.VIEW_RECONCILIATION_STAGES,
    stage.outletId,
    {
      type: 'RECONCILIATION_STAGE_REOPENED',
      title: `${labelForStage(stage.stageKey as StageKey)} reopened`,
      message: `${stage.date.toISOString().slice(0, 10)} was reopened by ${opts.actor.userName}: ${opts.reason}`,
      entityType: 'ReconciliationStage',
      entityId: stage.id,
    },
    { sendEmail: false }
  )
  return updated
}

// ─── Reminder / escalation (lazy check-on-read, no per-minute cron) ────────

/** Fires whichever reminder/escalation tier is due for one stage instance,
 *  based on the resolved ReconciliationReminderPolicy cadence. Idempotent —
 *  tracks the highest tier already sent via lastReminderTier so re-reads
 *  don't re-notify. Call before returning any OPEN/INCOMPLETE stage to a
 *  client (same pattern as autoLockExpiredBusinessDays). */
export async function checkGraceAndEscalate(stageId: string) {
  const stage = await prisma.reconciliationStage.findUnique({ where: { id: stageId } })
  if (!stage || !['OPEN', 'INCOMPLETE'].includes(stage.status)) return stage

  const { resolveReminderPolicy } = await import('@/lib/reconciliation-reminders')
  const policy = await resolveReminderPolicy(stage.stageKey as StageKey, { companyId: stage.companyId, outletId: stage.outletId })
  const config = await resolveStageConfig(stage.stageKey as StageKey, { companyId: stage.companyId, outletId: stage.outletId })

  const anchor = policy.reminderAnchor === 'END_TIME' && stage.gracePeriodEndsAt ? stage.gracePeriodEndsAt : stage.openedAt
  if (!anchor) return stage
  const elapsedMinutes = (Date.now() - anchor.getTime()) / 60000

  let nextTier = stage.lastReminderTier
  if (stage.lastReminderTier < 1 && elapsedMinutes >= policy.firstReminderMinutes) nextTier = 1
  if (stage.lastReminderTier < 2 && elapsedMinutes >= policy.secondReminderMinutes) nextTier = 2
  const pastEndOfWindow = stage.gracePeriodEndsAt ? Date.now() >= stage.gracePeriodEndsAt.getTime() : false
  if (stage.lastReminderTier < 3 && policy.escalationAtEndOfWindow && pastEndOfWindow) nextTier = 3

  if (nextTier === stage.lastReminderTier) return stage

  const { isComplete } = await runCloseValidation(stage.id)
  if (isComplete) return stage // resolved on its own — no need to notify

  if (nextTier < 3) {
    await notifyResourceHoldersMultiChannel(
      resourceForStage(stage.stageKey as StageKey),
      stage.outletId,
      {
        type: 'RECONCILIATION_REMINDER',
        title: `${labelForStage(stage.stageKey as StageKey)} pending`,
        message: `Reminder: ${labelForStage(stage.stageKey as StageKey)} for ${stage.date.toISOString().slice(0, 10)} is still incomplete. Action required.`,
        entityType: 'ReconciliationStage',
        entityId: stage.id,
      },
      { sendEmail: (JSON.parse(config.notifyChannels || '["IN_APP"]') as string[]).includes('EMAIL') }
    )
    await writeAuditLog(stage.id, { action: 'REMINDER_SENT', field: 'lastReminderTier', previousValue: String(stage.lastReminderTier), newValue: String(nextTier) })
    return prisma.reconciliationStage.update({ where: { id: stage.id }, data: { status: 'INCOMPLETE', lastReminderTier: nextTier } })
  }

  // Tier 3 — full escalation. Always in-app + email, regardless of config.
  const escalationRoles = config.escalationRoles ? JSON.parse(config.escalationRoles) : null
  await notifyResourceHoldersMultiChannel(
    RECONCILIATION_STAGE_RESOURCES.APPROVE_RECONCILIATION_UNLOCK,
    stage.outletId,
    {
      type: 'RECONCILIATION_ESCALATION',
      title: `Escalation: ${labelForStage(stage.stageKey as StageKey)} overdue`,
      message: `${labelForStage(stage.stageKey as StageKey)} for ${stage.date.toISOString().slice(0, 10)} has been incomplete past its reconciliation window and is now escalated${escalationRoles ? ` to ${escalationRoles.join(', ')}` : ''}.`,
      entityType: 'ReconciliationStage',
      entityId: stage.id,
    },
    { sendEmail: true }
  )
  await writeAuditLog(stage.id, { action: 'ESCALATED', field: 'lastReminderTier', previousValue: String(stage.lastReminderTier), newValue: '3' })

  const data: Record<string, unknown> = { lastReminderTier: 3, escalatedAt: new Date(), escalatedToRoles: config.escalationRoles ?? null, status: 'INCOMPLETE' }
  if (config.forceAutoClose) {
    data.status = 'CLOSED'
    data.autoClosed = true
    data.closedAt = new Date()
    data.result = 'MISSING_TRANSACTION'
    await writeAuditLog(stage.id, { action: 'AUTO_LOCK', reason: 'forceAutoClose policy — closed with unresolved checks past the grace period' })
  }
  return prisma.reconciliationStage.update({ where: { id: stage.id }, data })
}

/** Run the reminder/escalation check across every OPEN/INCOMPLETE stage
 *  matching a filter — call before any list endpoint returns stage rows. */
export async function checkGraceAndEscalateMany(where?: { companyId?: string; outletId?: string | null }) {
  const stages = await prisma.reconciliationStage.findMany({
    where: { status: { in: ['OPEN', 'INCOMPLETE'] }, ...(where?.companyId ? { companyId: where.companyId } : {}), ...(where?.outletId !== undefined ? { outletId: where.outletId } : {}) },
    select: { id: true },
  })
  for (const s of stages) await checkGraceAndEscalate(s.id)
}

// ─── Unlock request workflow ───────────────────────────────────────────────

export async function requestUnlock(opts: { stageId: string; actor: Actor; reason: string; requestedDuration?: string | null; requestedMinutes?: number | null }) {
  const request = await prisma.reconciliationStageUnlockRequest.create({
    data: {
      stageId: opts.stageId,
      requestedById: opts.actor.userId,
      requestedByName: opts.actor.userName,
      reason: opts.reason,
      requestedDuration: opts.requestedDuration ?? null,
      requestedMinutes: opts.requestedMinutes ?? null,
    },
  })
  const stage = await prisma.reconciliationStage.findUnique({ where: { id: opts.stageId } })
  if (stage) {
    await writeAuditLog(stage.id, { action: 'UNLOCK_REQUESTED', reason: opts.reason, userId: opts.actor.userId, userName: opts.actor.userName })
    await notifyResourceHoldersMultiChannel(
      RECONCILIATION_STAGE_RESOURCES.APPROVE_RECONCILIATION_UNLOCK,
      stage.outletId,
      {
        type: 'UNLOCK_REQUESTED',
        title: `Unlock requested: ${labelForStage(stage.stageKey as StageKey)}`,
        message: `${opts.actor.userName} requested an unlock for ${stage.date.toISOString().slice(0, 10)}: ${opts.reason}`,
        entityType: 'ReconciliationStageUnlockRequest',
        entityId: request.id,
      },
      { sendEmail: false }
    )
  }
  return request
}

export async function resolveUnlockRequest(opts: { requestId: string; approve: boolean; actor: Actor; comment?: string }) {
  const request = await prisma.reconciliationStageUnlockRequest.findUnique({ where: { id: opts.requestId } })
  if (!request) throw new Error('Unlock request not found')
  if (request.status !== 'PENDING') throw new Error('This request has already been resolved')

  const updated = await prisma.reconciliationStageUnlockRequest.update({
    where: { id: request.id },
    data: { status: opts.approve ? 'APPROVED' : 'REJECTED', approverId: opts.actor.userId, approverName: opts.actor.userName, approverComment: opts.comment, resolvedAt: new Date() },
  })

  if (opts.approve) {
    const minutes = resolveDurationMinutes(request.requestedDuration, request.requestedMinutes)
    await reopenStage({ stageId: request.stageId, actor: opts.actor, reason: `Unlock approved: ${request.reason}`, durationMinutes: minutes })
  }

  await writeAuditLog(request.stageId, {
    action: opts.approve ? 'UNLOCK_APPROVED' : 'UNLOCK_REJECTED',
    reason: opts.comment,
    approvedById: opts.actor.userId,
    approvedByName: opts.actor.userName,
  })

  return updated
}

// ─── Labels / resource mapping ──────────────────────────────────────────────

export function labelForStage(stageKey: StageKey): string {
  switch (stageKey) {
    case 'BUSINESS_DAY': return 'Business Day'
    case 'CASHIER_RECON': return 'Cashier Reconciliation'
    case 'FINANCE_RECON': return 'Finance Reconciliation'
    case 'FINANCIAL_CLOSE': return 'Financial Close'
    case 'ARCHIVED': return 'Archive'
  }
}

/** Loads just the stageKey for a stage id — cheap lookup so callers (e.g. the
 *  close route) can resolve the exact per-stage permission to check before
 *  running any state-changing operation. */
export async function getStageStageKey(stageId: string): Promise<StageKey | null> {
  const stage = await prisma.reconciliationStage.findUnique({ where: { id: stageId }, select: { stageKey: true } })
  return (stage?.stageKey as StageKey) ?? null
}

export function resourceForStage(stageKey: StageKey): ReconciliationStageResource {
  switch (stageKey) {
    case 'BUSINESS_DAY': return RECONCILIATION_STAGE_RESOURCES.CLOSE_CASHIER_RECON
    case 'CASHIER_RECON': return RECONCILIATION_STAGE_RESOURCES.CLOSE_CASHIER_RECON
    case 'FINANCE_RECON': return RECONCILIATION_STAGE_RESOURCES.CLOSE_FINANCE_RECON
    case 'FINANCIAL_CLOSE': return RECONCILIATION_STAGE_RESOURCES.CLOSE_FINANCIAL_CLOSE
    case 'ARCHIVED': return RECONCILIATION_STAGE_RESOURCES.VIEW_RECONCILIATION_STAGES
  }
}
