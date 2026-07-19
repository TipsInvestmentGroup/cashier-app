// Business Calendar Engine — the single source of truth every module should
// call for "what business date/week/financial year/shift is it right now",
// replacing ad-hoc clock math. Resolution order (narrowest wins):
//   OUTLET override > COMPANY override > OUTLET config > COMPANY config
//   > GLOBAL config > hardcoded default.
// Same scope/scopeId shape as lib/collection-mode.ts's CollectionModeConfig
// resolver. See docs/business-calendar-engine.md for the full design.
import { startOfWeek, endOfWeek, differenceInCalendarWeeks, startOfDay, subDays, addDays } from 'date-fns'
import { prisma } from '@/lib/prisma'
import {
  BusinessCalendarFields,
  CalendarScope,
  DEFAULT_BUSINESS_CALENDAR,
  normalizeBusinessCalendarFields,
  hhmmToMinutes,
} from '@/lib/business-calendar-shared'

export type { BusinessCalendarFields, CalendarScope }
export { DEFAULT_BUSINESS_CALENDAR }

interface ResolveArgs {
  outletId?: string | null
  date?: Date
}

interface ScopeKey {
  scope: CalendarScope
  scopeId: string | null
}

async function scopeChainFor(outletId?: string | null): Promise<ScopeKey[]> {
  const chain: ScopeKey[] = []
  let companyId: string | null = null
  if (outletId) {
    const outlet = await prisma.outlet.findUnique({ where: { id: outletId }, select: { companyId: true } })
    companyId = outlet?.companyId || null
    chain.push({ scope: 'OUTLET', scopeId: outletId })
  }
  if (companyId) chain.push({ scope: 'COMPANY', scopeId: companyId })
  chain.push({ scope: 'GLOBAL', scopeId: null })
  return chain
}

/** Resolves the effective calendar fields for an outlet (or globally, if no outlet given) on a given date. */
export async function resolveEffectiveConfig({ outletId, date }: ResolveArgs = {}): Promise<BusinessCalendarFields> {
  const chain = await scopeChainFor(outletId) // narrowest first: OUTLET, COMPANY, GLOBAL
  const at = date ?? new Date()

  const configRows = await prisma.businessCalendarConfig.findMany({
    where: { OR: chain.map((c) => ({ scope: c.scope, scopeId: c.scopeId })) },
  })
  const overrideRows = await prisma.businessCalendarOverride.findMany({
    where: {
      OR: chain.map((c) => ({ scope: c.scope, scopeId: c.scopeId })),
      startDate: { lte: at },
      endDate: { gte: at },
    },
  })

  // Apply widest-to-narrowest so narrower rows win.
  let effective = DEFAULT_BUSINESS_CALENDAR
  for (const c of [...chain].reverse()) {
    const row = configRows.find((r) => r.scope === c.scope && r.scopeId === c.scopeId)
    if (row) effective = normalizeBusinessCalendarFields({ ...effective, ...row })
  }
  for (const c of [...chain].reverse()) {
    const row = overrideRows.find((r) => r.scope === c.scope && r.scopeId === c.scopeId)
    if (row) {
      effective = normalizeBusinessCalendarFields({
        ...effective,
        ...(row.businessDayStartTime ? { businessDayStartTime: row.businessDayStartTime } : {}),
        ...(row.businessDayEndTime ? { businessDayEndTime: row.businessDayEndTime } : {}),
      })
    }
  }
  return effective
}

/** Wall-clock Y/M/D/H/M in a given IANA time zone, without an extra date library. */
function zonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const map: Record<string, string> = {}
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') map[p.type] = p.value
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: map.hour === '24' ? 0 : Number(map.hour),
    minute: Number(map.minute),
  }
}

/**
 * The one place that decides which calendar date a moment in time belongs to
 * for business purposes. A moment before the configured start time belongs
 * to the PREVIOUS business date — e.g. a 2am sale at a bar whose business
 * day starts at 09:00 belongs to yesterday.
 */
export function resolveBusinessDate(now: Date, effective: BusinessCalendarFields | number): Date {
  // Back-compat: callers still passing a plain cutover hour (the pre-engine
  // signature) keep working unchanged.
  if (typeof effective === 'number') {
    const d = now.getHours() < effective ? subDays(now, 1) : now
    return startOfDay(d)
  }
  const { year, month, day, hour, minute } = zonedParts(now, effective.timeZone)
  const nowMinutes = hour * 60 + minute
  const startMinutes = hhmmToMinutes(effective.businessDayStartTime)
  const local = new Date(year, month - 1, day)
  return nowMinutes < startMinutes ? subDays(local, 1) : local
}

export function getBusinessWeek(date: Date, weekStartDay: number) {
  const opts = { weekStartsOn: weekStartDay as 0 | 1 | 2 | 3 | 4 | 5 | 6 }
  const weekStart = startOfWeek(date, opts)
  const weekEnd = endOfWeek(date, opts)
  const weekNumber = differenceInCalendarWeeks(date, startOfWeek(new Date(date.getFullYear(), 0, 1), opts), opts) + 1
  return { weekStart, weekEnd, weekNumber }
}

export function getFinancialYear(date: Date, fyStartMonth: number, fyStartDay: number) {
  const candidate = new Date(date.getFullYear(), fyStartMonth - 1, fyStartDay)
  const fyStart = date < candidate ? new Date(date.getFullYear() - 1, fyStartMonth - 1, fyStartDay) : candidate
  const fyEnd = subDays(new Date(fyStart.getFullYear() + 1, fyStartMonth - 1, fyStartDay), 1)
  const label = fyStart.getFullYear() === fyEnd.getFullYear() ? `FY${fyStart.getFullYear()}` : `FY${fyStart.getFullYear()}-${fyEnd.getFullYear()}`
  return { fyStart, fyEnd, label }
}

export interface ShiftTemplateLike {
  id?: string
  name: string
  startTime: string
  endTime: string
}

/** The shift whose [start, end) window (wrapping past midnight if needed) contains "now", in the given zone. */
export function getActiveShift(now: Date, shifts: ShiftTemplateLike[], timeZone: string): ShiftTemplateLike | null {
  const { hour, minute } = zonedParts(now, timeZone)
  const nowMinutes = hour * 60 + minute
  for (const s of shifts) {
    const start = hhmmToMinutes(s.startTime)
    const end = hhmmToMinutes(s.endTime)
    const within = start === end ? true : end > start ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end
    if (within) return s
  }
  return null
}

export function getBusinessStatus(now: Date, effective: BusinessCalendarFields) {
  const { hour, minute, year, month, day } = zonedParts(now, effective.timeZone)
  const nowMinutes = hour * 60 + minute
  const start = hhmmToMinutes(effective.businessDayStartTime)
  const end = hhmmToMinutes(effective.businessDayEndTime)
  const isOpen = start === end ? true : end > start ? nowMinutes >= start && nowMinutes < end : nowMinutes >= start || nowMinutes < end
  const todayStart = new Date(year, month - 1, day)
  todayStart.setHours(Math.floor(start / 60), start % 60, 0, 0)
  const nextBusinessDayStart = nowMinutes < start ? todayStart : addDays(todayStart, 1)
  return { isOpen, nextBusinessDayStart }
}

interface Actor {
  userId?: string | null
  userName?: string | null
  reason?: string | null
}

/** Upsert one config row, writing one audit row per changed field. GLOBAL rows are looked up by findFirst (scopeId is NULL, and NULL != NULL in the unique index) — same pattern as lib/collection-mode.ts. */
export async function setBusinessCalendarConfig(scope: CalendarScope, scopeId: string | null, patch: Partial<BusinessCalendarFields>, actor: Actor = {}) {
  if (scope !== 'GLOBAL' && !scopeId) throw new Error(`scopeId is required for scope ${scope}`)
  const existing = scope === 'GLOBAL'
    ? await prisma.businessCalendarConfig.findFirst({ where: { scope: 'GLOBAL' } })
    : await prisma.businessCalendarConfig.findUnique({ where: { scope_scopeId: { scope, scopeId: scopeId as string } } })

  const current = normalizeBusinessCalendarFields(existing ?? {})
  const next = normalizeBusinessCalendarFields({ ...current, ...patch })

  const changedFields = (Object.keys(next) as (keyof BusinessCalendarFields)[]).filter((k) => String(current[k]) !== String(next[k]))

  const row = existing
    ? await prisma.businessCalendarConfig.update({ where: { id: existing.id }, data: next })
    : await prisma.businessCalendarConfig.create({ data: { scope, scopeId, ...next } })

  if (changedFields.length) {
    await prisma.businessCalendarAuditLog.createMany({
      data: changedFields.map((field) => ({
        scope,
        scopeId,
        field,
        previousValue: String(current[field]),
        newValue: String(next[field]),
        reason: actor.reason ?? null,
        userId: actor.userId ?? null,
        userName: actor.userName ?? null,
      })),
    })
  }
  return row
}

export async function listBusinessCalendarConfigs() {
  return prisma.businessCalendarConfig.findMany({ orderBy: [{ scope: 'asc' }, { createdAt: 'asc' }] })
}

export async function listShiftTemplates(scope?: CalendarScope, scopeId?: string | null) {
  return prisma.shiftTemplate.findMany({
    where: scope ? { scope, scopeId: scopeId ?? null } : undefined,
    orderBy: { sortOrder: 'asc' },
  })
}

export async function upsertShiftTemplate(input: { id?: string; scope: CalendarScope; scopeId: string | null; name: string; startTime: string; endTime: string; sortOrder?: number }) {
  if (input.id) {
    return prisma.shiftTemplate.update({
      where: { id: input.id },
      data: { name: input.name, startTime: input.startTime, endTime: input.endTime, sortOrder: input.sortOrder ?? 0 },
    })
  }
  return prisma.shiftTemplate.create({
    data: { scope: input.scope, scopeId: input.scopeId, name: input.name, startTime: input.startTime, endTime: input.endTime, sortOrder: input.sortOrder ?? 0 },
  })
}

export async function deleteShiftTemplate(id: string) {
  return prisma.shiftTemplate.delete({ where: { id } })
}

export async function listBusinessCalendarOverrides(scope?: CalendarScope, scopeId?: string | null) {
  return prisma.businessCalendarOverride.findMany({
    where: scope ? { scope, scopeId: scopeId ?? null } : undefined,
    orderBy: { startDate: 'desc' },
  })
}

export async function createBusinessCalendarOverride(input: {
  scope: CalendarScope
  scopeId: string | null
  startDate: Date
  endDate: Date
  businessDayStartTime?: string
  businessDayEndTime?: string
  reason?: string
  createdBy?: string
}) {
  return prisma.businessCalendarOverride.create({ data: input })
}

export async function deleteBusinessCalendarOverride(id: string) {
  return prisma.businessCalendarOverride.delete({ where: { id } })
}

export async function getBusinessCalendarAuditLog(scope?: CalendarScope, scopeId?: string | null, limit = 100) {
  return prisma.businessCalendarAuditLog.findMany({
    where: scope ? { scope, scopeId: scopeId ?? null } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

/** Convenience: resolve everything a "Business Calendar Dashboard" widget needs for one outlet (or globally). */
export async function getBusinessCalendarSnapshot(outletId?: string | null, now: Date = new Date()) {
  const effective = await resolveEffectiveConfig({ outletId, date: now })
  const businessDate = resolveBusinessDate(now, effective)
  const { weekStart, weekEnd, weekNumber } = getBusinessWeek(businessDate, effective.weekStartDay)
  const { fyStart, fyEnd, label: financialYearLabel } = getFinancialYear(businessDate, effective.fyStartMonth, effective.fyStartDay)
  const shifts = await listShiftTemplates(outletId ? 'OUTLET' : 'GLOBAL', outletId ?? null)
  const activeShift = getActiveShift(now, shifts, effective.timeZone)
  const { isOpen, nextBusinessDayStart } = getBusinessStatus(now, effective)
  return {
    config: effective,
    businessDate,
    week: { weekStart, weekEnd, weekNumber },
    financialYear: { fyStart, fyEnd, label: financialYearLabel },
    activeShift,
    isOpen,
    nextBusinessDayStart,
  }
}
