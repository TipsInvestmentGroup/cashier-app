// Business Period Engine — server side. Resolves the effective (versioned,
// scoped) monthly-cycle config for any date and turns it into live period
// info every module can consume. Sits on top of the day/week/FY engine in
// lib/business-calendar.ts and reuses its scope chain + audit table.
//
// Resolution (narrowest scope wins; within a scope the newest version whose
// effectiveDate <= target date):
//   OUTLET version > COMPANY version > GLOBAL version > hardcoded default.
// A scope only wins if it HAS a version effective by the target date — so a
// brand-new outlet override effective 1 Mar does not retro-apply to February;
// February falls through to the company/global/default in force then. That is
// exactly the historical-accuracy guarantee (requirement #6).
import { prisma } from '@/lib/prisma'
import {
  BusinessPeriodFields,
  DEFAULT_BUSINESS_PERIODS,
  normalizeBusinessPeriodFields,
  monthlyPeriodForDate,
  nextMonthlyPeriod,
  generateMonthlyPeriods,
  payrollPeriodForDate,
  creditCycleForDate,
} from '@/lib/business-periods-shared'
import type { CalendarScope } from '@/lib/business-calendar-shared'
import { resolveEffectiveConfig, resolveBusinessDate } from '@/lib/business-calendar'

export type { BusinessPeriodFields }

interface ScopeKey {
  scope: CalendarScope
  scopeId: string | null
}

// Same shape as lib/business-calendar.ts's scopeChainFor — kept local so the
// two engines stay independently changeable. Accepts an outletId (walks
// OUTLET → COMPANY → GLOBAL) or, for company-level callers with no outlet
// (e.g. accounting periods), a bare companyId (walks COMPANY → GLOBAL).
async function scopeChainFor(outletId?: string | null, companyId?: string | null): Promise<ScopeKey[]> {
  const chain: ScopeKey[] = []
  let company: string | null = companyId || null
  if (outletId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    company = outlet?.companyId || company
    chain.push({ scope: 'OUTLET', scopeId: outletId })
  }
  if (company) chain.push({ scope: 'COMPANY', scopeId: company })
  chain.push({ scope: 'GLOBAL', scopeId: null })
  return chain
}

/** Resolve the monthly-cycle fields effective for an outlet, a company, or
 *  globally on `date` (narrowest of the three that has a version wins). */
export async function resolveEffectivePeriodFields({ outletId, companyId, date }: { outletId?: string | null; companyId?: string | null; date?: Date } = {}): Promise<BusinessPeriodFields> {
  const chain = await scopeChainFor(outletId, companyId) // narrowest first
  const at = date ?? new Date()

  const rows = await prisma.businessPeriodVersion.findMany({
    where: {
      OR: chain.map((c) => ({ scope: c.scope, scopeId: c.scopeId })),
      effectiveDate: { lte: at },
    },
    orderBy: { effectiveDate: 'desc' },
  })

  // First scope in the chain (narrowest) that has any version effective by `at` wins.
  for (const c of chain) {
    const winner = rows.find((r) => r.scope === c.scope && r.scopeId === c.scopeId)
    if (winner) return normalizeBusinessPeriodFields(winner)
  }
  return DEFAULT_BUSINESS_PERIODS
}

interface Actor {
  userId?: string | null
  userName?: string | null
  reason?: string | null
}

/**
 * Insert a new effective-dated version (or update the one already stored at the
 * exact same scope+effectiveDate). Writes one BusinessCalendarAuditLog row per
 * changed field, comparing against the version that was effective immediately
 * before this one at the same scope.
 */
export async function saveBusinessPeriodVersion(
  scope: CalendarScope,
  scopeId: string | null,
  fields: BusinessPeriodFields,
  effectiveDate: Date,
  presetName: string,
  actor: Actor = {},
) {
  if (scope !== 'GLOBAL' && !scopeId) throw new Error(`scopeId is required for scope ${scope}`)

  // Date-only: normalise to local midnight so "effective on this day" is exact.
  const eff = new Date(effectiveDate.getFullYear(), effectiveDate.getMonth(), effectiveDate.getDate())

  const existingSameDay = scope === 'GLOBAL'
    ? await prisma.businessPeriodVersion.findFirst({ where: { scope: 'GLOBAL', effectiveDate: eff } })
    : await prisma.businessPeriodVersion.findFirst({ where: { scope, scopeId, effectiveDate: eff } })

  // Baseline for the audit diff: the current stored values if we're editing this
  // exact version, otherwise the version effective just before it at this scope.
  let baselineRow = existingSameDay
  if (!baselineRow) {
    baselineRow = await prisma.businessPeriodVersion.findFirst({
      where: { scope, scopeId, effectiveDate: { lt: eff } },
      orderBy: { effectiveDate: 'desc' },
    })
  }
  const baseline = baselineRow ? normalizeBusinessPeriodFields(baselineRow) : DEFAULT_BUSINESS_PERIODS
  const next = normalizeBusinessPeriodFields(fields)

  const data = { ...next, presetName, reason: actor.reason ?? null }
  const row = existingSameDay
    ? await prisma.businessPeriodVersion.update({ where: { id: existingSameDay.id }, data })
    : await prisma.businessPeriodVersion.create({
        data: { scope, scopeId, effectiveDate: eff, createdBy: actor.userId ?? null, createdByName: actor.userName ?? null, ...data },
      })

  const changedFields = (Object.keys(next) as (keyof BusinessPeriodFields)[]).filter((k) => String(baseline[k]) !== String(next[k]))
  if (changedFields.length) {
    await prisma.businessCalendarAuditLog.createMany({
      data: changedFields.map((field) => ({
        scope,
        scopeId,
        field,
        previousValue: String(baseline[field]),
        newValue: String(next[field]),
        reason: actor.reason ?? null,
        userId: actor.userId ?? null,
        userName: actor.userName ?? null,
      })),
    })
  }
  return row
}

export async function listBusinessPeriodVersions(scope?: CalendarScope, scopeId?: string | null) {
  return prisma.businessPeriodVersion.findMany({
    where: scope ? { scope, scopeId: scopeId ?? null } : undefined,
    orderBy: [{ scope: 'asc' }, { effectiveDate: 'desc' }],
  })
}

export async function deleteBusinessPeriodVersion(id: string) {
  return prisma.businessPeriodVersion.delete({ where: { id } })
}

/** Business-month {start, end-of-day} range for reports — the single helper a
 *  report route calls to group a date into its configured operational month. */
export async function getBusinessMonthRange(outletId: string | null | undefined, date: Date) {
  const fields = await resolveEffectivePeriodFields({ outletId, date })
  const p = monthlyPeriodForDate(date, fields.businessMonthStartDay)
  const end = new Date(p.end)
  end.setHours(23, 59, 59, 999)
  return { start: p.start, end, name: p.name, rangeLabel: p.rangeLabel, key: p.key }
}

/**
 * Everything a "Business Periods" dashboard/preview needs for one outlet (or
 * globally): the resolved cycle fields, the current + next window of each of
 * the four cycles, and an auto-generated run of upcoming business months.
 * `now` is resolved to a business date first (so a 2am sale is grouped like the
 * rest of the day/week engine treats it).
 */
export async function getBusinessPeriodSnapshot(outletId?: string | null, now: Date = new Date(), upcomingCount = 6) {
  const calendar = await resolveEffectiveConfig({ outletId, date: now })
  const businessDate = resolveBusinessDate(now, calendar)
  const fields = await resolveEffectivePeriodFields({ outletId, date: businessDate })

  const businessMonth = monthlyPeriodForDate(businessDate, fields.businessMonthStartDay)
  const nextBusinessMonth = nextMonthlyPeriod(businessDate, fields.businessMonthStartDay)
  const financialMonth = monthlyPeriodForDate(businessDate, fields.financialMonthStartDay)
  const payroll = payrollPeriodForDate(businessDate, fields)
  const credit = creditCycleForDate(businessDate, fields)
  const upcoming = generateMonthlyPeriods(businessDate, fields.businessMonthStartDay, upcomingCount)

  return { fields, businessDate, businessMonth, nextBusinessMonth, financialMonth, payroll, credit, upcoming }
}
