// Business Day Exception Management — core resolver/mutator functions.
// BusinessDay is per Outlet+Date (matches DailyCollection/CashRecon/DayClosure
// grain); PosShift/PosCounter are surfaced only as an informational breakdown
// of which shift/counter is missing a record, never separate lockable units.
// DayClosure is kept in sync (upsert on close, delete on reopen) for any
// legacy reader that still queries it directly.
import { startOfDay, endOfDay, addMinutes } from 'date-fns'
import { prisma } from '@/lib/prisma'
import { getCollectionSessionTotals } from '@/lib/collection-session-totals'
import { notifyResourceHolders } from '@/lib/notifications'
import { BUSINESS_DAY_RESOURCES } from '@/lib/rbac'

export type BusinessDayStatus = 'OPEN' | 'CLOSED' | 'REOPENED' | 'ARCHIVED'

export interface MissingItem {
  type: string
  label: string
  shift?: string
  counter?: string
}

interface Actor {
  userId: string
  userName: string
}

const DURATION_MINUTES: Record<string, number> = { '15m': 15, '30m': 30, '1h': 60 }

export function resolveDurationMinutes(requestedDuration?: string | null, requestedMinutes?: number | null): number {
  if (requestedDuration === 'CUSTOM') return Math.max(1, requestedMinutes || 30)
  return DURATION_MINUTES[requestedDuration || '30m'] ?? 30
}

// ─── Policy config (GLOBAL → COMPANY → OUTLET, narrowest wins) ─────────────

export async function resolveBusinessDayPolicy(outletId?: string | null) {
  const priority: { scope: string; scopeId: string | null }[] = []
  let companyId: string | null = null
  if (outletId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    companyId = outlet?.companyId || null
    priority.push({ scope: 'OUTLET', scopeId: outletId })
  }
  if (companyId) priority.push({ scope: 'COMPANY', scopeId: companyId })
  priority.push({ scope: 'GLOBAL', scopeId: null })

  const rows = await prisma.businessDayPolicyConfig.findMany({
    where: { OR: priority.map((p) => ({ scope: p.scope, scopeId: p.scopeId })) },
  })
  for (const p of priority) {
    const row = rows.find((r) => r.scope === p.scope && r.scopeId === p.scopeId)
    if (row) return row
  }
  return { blockCloseOnMissing: true, approverRoles: null as string | null, defaultUnlockMinutes: 30 }
}

// ─── Core lookups ───────────────────────────────────────────────────────────

export async function getOrCreateBusinessDay(outletId: string, date: Date) {
  const day = startOfDay(date)
  return prisma.businessDay.upsert({
    where: { outletId_date: { outletId, date: day } },
    update: {},
    create: { outletId, date: day, status: 'OPEN' },
  })
}

async function writeAuditLog(businessDayId: string, entry: {
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
  return prisma.businessDayAuditLog.create({ data: { businessDayId, ...entry } })
}

// ─── Missing Data Detection ─────────────────────────────────────────────────

export async function runMissingDataDetection({ outletId, date }: { outletId: string; date: Date }): Promise<{ isComplete: boolean; missingItems: MissingItem[] }> {
  const range = { gte: startOfDay(date), lte: endOfDay(date) }
  const missingItems: MissingItem[] = []

  // SalesImportLine types are generated on deploy; assert to avoid local drift.
  const db = prisma as any // eslint-disable-line @typescript-eslint/no-explicit-any
  const [cashRecon, digitalCount, dailyCollectionCount, salesMetricCount, importedSalesCount, shifts, counters] = await Promise.all([
    prisma.cashRecon.findFirst({ where: { outletId, date: range }, select: { id: true } }),
    prisma.bankRecon.count({ where: { outletId, date: range, channel: { not: null } } }),
    prisma.dailyCollection.count({ where: { outletId, date: range } }),
    prisma.salesMetric.count({ where: { outletId, date: range } }),
    // A committed Sales Import counts as sales figures even when the day has no
    // SHISHA/FOOD line (e.g. a drinks-only day writes no SalesMetric row).
    db.salesImportLine.count({ where: { outletId, date: range, superseded: false, import: { status: 'IMPORTED' } } }),
    prisma.posShift.findMany({ where: { outletId, date: range }, select: { name: true, closedAt: true } }),
    prisma.posCounter.findMany({ where: { outletId, isActive: true }, select: { code: true, label: true } }),
  ])

  if (!cashRecon) missingItems.push({ type: 'CASH_RECONCILIATION', label: 'Cash Reconciliation not completed' })
  if (digitalCount === 0) missingItems.push({ type: 'BILLS', label: 'Digital/Bank Reconciliation not completed' })
  if (dailyCollectionCount === 0) missingItems.push({ type: 'COLLECTIONS', label: 'No Daily Collection recorded' })
  if (salesMetricCount === 0 && importedSalesCount === 0) missingItems.push({ type: 'SALES', label: 'No Sales figures recorded' })

  const templateSessions = await getCollectionSessionTotals({ outletId, dateRange: range })
  for (const s of templateSessions) {
    if (s.hasOpenWork) missingItems.push({ type: 'REQUIRED_VALIDATION', label: `Open Collection Template session: ${s.templateName}` })
  }

  // Informational breakdown: any shift that opened today but never closed —
  // attach shift/counter labels where derivable, never a separate lock unit.
  for (const shift of shifts) {
    if (!shift.closedAt) missingItems.push({ type: 'OPEN_SHIFT', label: `Shift ${shift.name} not closed`, shift: shift.name })
  }
  void counters // counters are attached to missing items above only when a check can name one; reserved for future per-counter checks

  return { isComplete: missingItems.length === 0, missingItems }
}

// ─── Close / Reopen / Lock ──────────────────────────────────────────────────

export async function closeBusinessDay({ outletId, date, actor, allowIncomplete }: { outletId: string; date: Date; actor: Actor; allowIncomplete?: boolean }) {
  const day = startOfDay(date)
  const { isComplete, missingItems } = await runMissingDataDetection({ outletId, date: day })
  const policy = await resolveBusinessDayPolicy(outletId)

  if (!isComplete && policy.blockCloseOnMissing && !allowIncomplete) {
    const bd = await getOrCreateBusinessDay(outletId, day)
    await prisma.businessDay.update({ where: { id: bd.id }, data: { isComplete: false, missingItems: JSON.stringify(missingItems) } })
    await notifyResourceHolders(BUSINESS_DAY_RESOURCES.CLOSE_BUSINESS_DAY, outletId, {
      type: 'MISSING_DATA_DETECTED',
      title: 'Missing data detected',
      message: `${day.toISOString().slice(0, 10)} at this outlet has ${missingItems.length} missing item(s) — day cannot close yet.`,
      entityType: 'BusinessDay',
      entityId: bd.id,
    })
    return { blocked: true as const, missingItems }
  }

  const bd = await getOrCreateBusinessDay(outletId, day)
  const updated = await prisma.businessDay.update({
    where: { id: bd.id },
    data: {
      status: 'CLOSED',
      isComplete,
      missingItems: JSON.stringify(missingItems),
      closedById: actor.userId,
      closedByName: actor.userName,
      closedAt: new Date(),
      lockExpiresAt: null,
    },
  })
  await writeAuditLog(bd.id, {
    action: isComplete ? 'CLOSE' : 'ALLOW_INCOMPLETE_CLOSE',
    reason: allowIncomplete && !isComplete ? 'Closed with missing data (override)' : undefined,
    userId: actor.userId,
    userName: actor.userName,
  })

  await prisma.dayClosure.upsert({
    where: { outletId_date: { outletId, date: day } },
    update: {},
    create: { outletId, date: day, closedBy: actor.userName, closedById: actor.userId },
  })

  return { blocked: false as const, businessDay: updated }
}

export async function reopenBusinessDay({ outletId, date, actor, reason, durationMinutes }: {
  outletId: string
  date: Date
  actor: Actor
  reason: string
  durationMinutes: number | null // null = indefinite (management-only direct unlock)
}) {
  const day = startOfDay(date)
  const bd = await getOrCreateBusinessDay(outletId, day)
  const lockExpiresAt = durationMinutes != null ? addMinutes(new Date(), durationMinutes) : null

  const updated = await prisma.businessDay.update({
    where: { id: bd.id },
    data: {
      status: 'REOPENED',
      reopenedById: actor.userId,
      reopenedByName: actor.userName,
      reopenedAt: new Date(),
      reopenReason: reason,
      lockExpiresAt,
    },
  })
  await writeAuditLog(bd.id, { action: 'REOPEN', reason, userId: actor.userId, userName: actor.userName })

  await prisma.dayClosure.deleteMany({ where: { outletId, date: day } })

  await notifyResourceHolders(BUSINESS_DAY_RESOURCES.VIEW_BUSINESS_DAYS, outletId, {
    type: 'DAY_REOPENED',
    title: 'Business day reopened',
    message: `${day.toISOString().slice(0, 10)} at this outlet was reopened by ${actor.userName}: ${reason}`,
    entityType: 'BusinessDay',
    entityId: bd.id,
  })

  return updated
}

export async function lockBusinessDay({ businessDayId, actor }: { businessDayId: string; actor: Actor }) {
  const bd = await prisma.businessDay.findUnique({ where: { id: businessDayId } })
  if (!bd) throw new Error('Business day not found')
  const updated = await prisma.businessDay.update({
    where: { id: businessDayId },
    data: { status: 'CLOSED', lockExpiresAt: null },
  })
  await writeAuditLog(businessDayId, { action: 'LOCK', userId: actor.userId, userName: actor.userName })
  await prisma.dayClosure.upsert({
    where: { outletId_date: { outletId: bd.outletId, date: bd.date } },
    update: {},
    create: { outletId: bd.outletId, date: bd.date, closedBy: actor.userName, closedById: actor.userId },
  })
  return updated
}

// ─── Lazy expiry-check-on-read (no per-minute cron available) ──────────────

/** Flip every REOPENED row past its lockExpiresAt back to CLOSED, writing one
 *  AUTO_LOCK audit row + UNLOCK_EXPIRED notification per row. Call this before
 *  any read that lists/returns BusinessDay rows. */
export async function autoLockExpiredBusinessDays(where?: { outletId?: string | null }) {
  const now = new Date()
  const expired = await prisma.businessDay.findMany({
    where: { status: 'REOPENED', lockExpiresAt: { lt: now }, ...(where?.outletId ? { outletId: where.outletId } : {}) },
  })
  if (!expired.length) return

  await prisma.businessDay.updateMany({
    where: { id: { in: expired.map((e) => e.id) } },
    data: { status: 'CLOSED', lockExpiresAt: null },
  })

  for (const bd of expired) {
    await writeAuditLog(bd.id, { action: 'AUTO_LOCK' })
    await prisma.dayClosure.upsert({
      where: { outletId_date: { outletId: bd.outletId, date: bd.date } },
      update: {},
      create: { outletId: bd.outletId, date: bd.date, closedBy: 'System (auto-lock)' },
    })
    await notifyResourceHolders(BUSINESS_DAY_RESOURCES.VIEW_BUSINESS_DAYS, bd.outletId, {
      type: 'UNLOCK_EXPIRED',
      title: 'Unlock window expired',
      message: `${bd.date.toISOString().slice(0, 10)} at this outlet was auto-locked — the unlock window expired.`,
      entityType: 'BusinessDay',
      entityId: bd.id,
    })
  }
}
