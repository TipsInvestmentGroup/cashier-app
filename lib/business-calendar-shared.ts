// Business Calendar Engine — types/defaults/templates shared between server
// code (lib/business-calendar.ts) and client components. Dependency-free (no
// prisma import), same split as company-config-shared.ts.
//
// The defaults reproduce today's actual behavior (05:00 cutover, no explicit
// trading-window end, Tanzania time, week starts Monday, FY = calendar year)
// so a deployment that never opens Settings -> Business Calendar sees no
// change at all.

export const CALENDAR_SCOPES = ['GLOBAL', 'COMPANY', 'OUTLET'] as const
export type CalendarScope = (typeof CALENDAR_SCOPES)[number]

export interface BusinessCalendarFields {
  templateName: string
  businessDayStartTime: string // "HH:mm" — business day rolls over here
  businessDayEndTime: string // "HH:mm" — informational trading-window end
  timeZone: string // IANA zone, e.g. "Africa/Dar_es_Salaam"
  weekStartDay: number // 0=Sunday .. 6=Saturday
  fyStartMonth: number // 1-12
  fyStartDay: number // 1-31
}

export const DEFAULT_BUSINESS_CALENDAR: BusinessCalendarFields = {
  templateName: 'BAR',
  businessDayStartTime: '05:00',
  businessDayEndTime: '05:00',
  timeZone: 'Africa/Dar_es_Salaam',
  weekStartDay: 1,
  fyStartMonth: 1,
  fyStartDay: 1,
}

export const BUSINESS_HOUR_TEMPLATES: Record<string, { label: string; fields: Partial<BusinessCalendarFields> }> = {
  RETAIL: { label: 'Retail', fields: { businessDayStartTime: '08:00', businessDayEndTime: '20:00' } },
  RESTAURANT: { label: 'Restaurant', fields: { businessDayStartTime: '10:00', businessDayEndTime: '23:00' } },
  BAR: { label: 'Bar / Lounge', fields: { businessDayStartTime: '09:00', businessDayEndTime: '05:00' } },
  HOTEL_24H: { label: 'Hotel (24 Hours)', fields: { businessDayStartTime: '00:00', businessDayEndTime: '00:00' } },
  MANUFACTURING: { label: 'Manufacturing', fields: { businessDayStartTime: '06:00', businessDayEndTime: '18:00' } },
  OFFICE: { label: 'Office', fields: { businessDayStartTime: '08:30', businessDayEndTime: '17:30' } },
  CUSTOM: { label: 'Custom', fields: {} },
}

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidHHmm(v: unknown): v is string {
  return typeof v === 'string' && HHMM_RE.test(v)
}

export function parseHHmm(v: string): { h: number; m: number } {
  const match = HHMM_RE.exec(v)
  if (!match) return { h: 0, m: 0 }
  return { h: Number(match[1]), m: Number(match[2]) }
}

export function hhmmToMinutes(v: string): number {
  const { h, m } = parseHHmm(v)
  return h * 60 + m
}

/**
 * Client-side business date resolver — for components that only have the
 * browser's own clock (no server-side Intl time-zone conversion). Used by
 * pages that need an immediate default before their calendar snapshot fetch
 * resolves, e.g. defaulting a new Daily Collection's date. Assumes the
 * browser's local clock already matches the outlet's time zone, which holds
 * for on-site staff — the same assumption the pre-engine cutover logic made.
 */
export function resolveBusinessDateLocal(now: Date, startTime: string): Date {
  const startMinutes = hhmmToMinutes(startTime)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (nowMinutes < startMinutes) d.setDate(d.getDate() - 1)
  return d
}

/** Merge a stored/partial object over the defaults, dropping bad values. */
export function normalizeBusinessCalendarFields(raw: unknown): BusinessCalendarFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const time = (k: keyof BusinessCalendarFields) => (isValidHHmm(r[k]) ? (r[k] as string) : (DEFAULT_BUSINESS_CALENDAR[k] as string))
  const int = (k: keyof BusinessCalendarFields, min: number, max: number) => {
    const n = Number(r[k])
    return Number.isInteger(n) && n >= min && n <= max ? n : (DEFAULT_BUSINESS_CALENDAR[k] as number)
  }
  return {
    templateName: typeof r.templateName === 'string' && r.templateName in BUSINESS_HOUR_TEMPLATES ? r.templateName : DEFAULT_BUSINESS_CALENDAR.templateName,
    businessDayStartTime: time('businessDayStartTime'),
    businessDayEndTime: time('businessDayEndTime'),
    timeZone: typeof r.timeZone === 'string' && r.timeZone.trim() ? r.timeZone.trim() : DEFAULT_BUSINESS_CALENDAR.timeZone,
    weekStartDay: int('weekStartDay', 0, 6),
    fyStartMonth: int('fyStartMonth', 1, 12),
    fyStartDay: int('fyStartDay', 1, 31),
  }
}

/** Validation used before persisting a config — returns a list of human-readable problems (empty = valid). */
export function validateBusinessCalendarFields(fields: BusinessCalendarFields): string[] {
  const problems: string[] = []
  if (!isValidHHmm(fields.businessDayStartTime)) problems.push('Business day start time must be a valid HH:mm value.')
  if (!isValidHHmm(fields.businessDayEndTime)) problems.push('Business day end time must be a valid HH:mm value.')
  if (isValidHHmm(fields.businessDayStartTime) && isValidHHmm(fields.businessDayEndTime)) {
    const start = hhmmToMinutes(fields.businessDayStartTime)
    const end = hhmmToMinutes(fields.businessDayEndTime)
    if (start !== end) {
      const span = end > start ? end - start : 24 * 60 - start + end
      if (span < 60) problems.push('The business day span must be at least 1 hour.')
    }
  }
  if (fields.weekStartDay < 0 || fields.weekStartDay > 6) problems.push('Week start day must be between Sunday and Saturday.')
  if (fields.fyStartMonth < 1 || fields.fyStartMonth > 12) problems.push('Financial year start month must be 1-12.')
  const daysInMonth = new Date(2024, fields.fyStartMonth, 0).getDate()
  if (fields.fyStartDay < 1 || fields.fyStartDay > daysInMonth) problems.push('Financial year start day is not valid for that month.')
  return problems
}
