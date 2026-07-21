// Business Period Engine — configurable monthly cycles (Business Month, Financial
// Month, Payroll Period, Credit Cycle) layered ON TOP OF the Business Calendar
// day/week/FY engine (lib/business-calendar-shared.ts). Dependency-free (no
// prisma, no server imports) so both the API and client components can call it.
//
// Design decisions (see docs/business-calendar-engine.md §"Period cycles"):
//   • Each cycle is defined by a single START DAY of the month. The end day is
//     ALWAYS derived (day before the next cycle's start), which structurally
//     makes overlaps and gaps impossible — satisfying validation requirement #7
//     without runtime overlap checks.
//   • Cycles are effective-DATED: config is versioned, and generating any
//     period for a past date uses the version that was active then, so
//     historical reports never change (requirement #6). The versioning lives in
//     the server resolver (lib/business-periods.ts); this file only does the
//     pure date math for one already-resolved config.
//   • Days > 28 are allowed and CLAMPED to each month's real last day, so a
//     start day of 31 yields 28/29/30/31 automatically (requirement #7).
//   • Zero-config default = start day 1 everywhere = plain calendar months, so
//     an unconfigured deployment groups exactly as it always has.

export const CYCLE_KEYS = ['businessMonth', 'financialMonth', 'payroll', 'credit'] as const
export type CycleKey = (typeof CYCLE_KEYS)[number]

export interface BusinessPeriodFields {
  // Business Month — operational/sales/inventory/KPI reporting month.
  businessMonthStartDay: number // 1-31 (clamped per month)

  // Financial Month — accounting period month (GL/P&L/Balance Sheet). The
  // financial YEAR start still lives on BusinessCalendarConfig (fyStartMonth/Day).
  financialMonthStartDay: number // 1-31

  // Payroll Period — independent of the business month. The settlement events
  // (processing / salary payment / lock) are day-of-month values resolved in
  // the SETTLEMENT MONTH = the calendar month AFTER the period's start month.
  // Example: period 25 Jun→24 Jul ⇒ settlement month = July ⇒ processing 25 Jul,
  // payment 28 Jul.
  payrollStartDay: number // 1-31
  payrollProcessingDay: number // 1-31, in settlement month
  payrollPaymentDay: number // 1-31, in settlement month
  payrollLockDay: number // 1-31, in settlement month

  // Credit Cycle — independent. resetDay is when limits reset (defaults to the
  // next cycle start); graceDays optionally extends the due window past the end.
  creditStartDay: number // 1-31
  creditResetDay: number // 1-31
  creditGraceDays: number // 0-90
}

export const DEFAULT_BUSINESS_PERIODS: BusinessPeriodFields = {
  businessMonthStartDay: 1,
  financialMonthStartDay: 1,
  payrollStartDay: 1,
  payrollProcessingDay: 1,
  payrollPaymentDay: 1,
  payrollLockDay: 1,
  creditStartDay: 1,
  creditResetDay: 1,
  creditGraceDays: 0,
}

// Presets an admin can pick as a starting point (still fully editable after).
export const PERIOD_PRESETS: Record<string, { label: string; fields: Partial<BusinessPeriodFields> }> = {
  CALENDAR: {
    label: 'Calendar month (1st–end)',
    fields: { businessMonthStartDay: 1, financialMonthStartDay: 1, payrollStartDay: 1, payrollProcessingDay: 1, payrollPaymentDay: 5, payrollLockDay: 1, creditStartDay: 1, creditResetDay: 1 },
  },
  MID_MONTH_25: {
    label: '25th → 24th cycle',
    fields: { businessMonthStartDay: 25, financialMonthStartDay: 25, payrollStartDay: 25, payrollProcessingDay: 25, payrollPaymentDay: 28, payrollLockDay: 24, creditStartDay: 25, creditResetDay: 25 },
  },
  CUSTOM: { label: 'Custom', fields: {} },
}

// ─── numeric helpers ───────────────────────────────────────────────────────

function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate()
}

/** Clamp a day-of-month to a specific month's real length (handles 28/29/30/31). */
export function clampDayToMonth(year: number, month0: number, day: number): number {
  return Math.min(Math.max(1, day), daysInMonth(year, month0))
}

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/** Merge a stored/partial object over the defaults, dropping bad values. */
export function normalizeBusinessPeriodFields(raw: unknown): BusinessPeriodFields {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_BUSINESS_PERIODS
  return {
    businessMonthStartDay: intIn(r.businessMonthStartDay, 1, 31, d.businessMonthStartDay),
    financialMonthStartDay: intIn(r.financialMonthStartDay, 1, 31, d.financialMonthStartDay),
    payrollStartDay: intIn(r.payrollStartDay, 1, 31, d.payrollStartDay),
    payrollProcessingDay: intIn(r.payrollProcessingDay, 1, 31, d.payrollProcessingDay),
    payrollPaymentDay: intIn(r.payrollPaymentDay, 1, 31, d.payrollPaymentDay),
    payrollLockDay: intIn(r.payrollLockDay, 1, 31, d.payrollLockDay),
    creditStartDay: intIn(r.creditStartDay, 1, 31, d.creditStartDay),
    creditResetDay: intIn(r.creditResetDay, 1, 31, d.creditResetDay),
    creditGraceDays: intIn(r.creditGraceDays, 0, 90, d.creditGraceDays),
  }
}

// ─── core period math ────────────────────────────────────────────────────────

export interface MonthlyPeriod {
  start: Date // 00:00 of the first day of the period (local wall-clock date)
  end: Date // 00:00 of the LAST day of the period (inclusive; caller adds end-of-day)
  /** Calendar day of `start`/`end` as "YYYY-MM-DD", read from the Date's own
   *  parts — tz-proof, so a client in any zone gets the same business day the
   *  server computed (never re-derived from a UTC timestamp). */
  startYMD: string
  endYMD: string
  /** Human name, by the month the period predominantly falls in — its END month.
   *  e.g. a 25 Jun→24 Jul period is "Jul 2026" (24 of its 30 days are July). */
  name: string
  /** "25 Jun 2026 → 24 Jul 2026" */
  rangeLabel: string
  /** Stable sortable key of the period's end month, e.g. "2026-07". */
  key: string
}

/** "YYYY-MM-DD" from a Date's local parts (matches how periods are built). */
export function formatYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function fmt(d: Date): string {
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

function addMonth0(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 }
}

/**
 * The monthly period (defined by `startDay`) that CONTAINS `date`.
 * Naming: the period is named for its END month, the operational-month
 * convention (a 25 May–24 Jun window is "June"). startDay=1 ⇒ calendar month.
 */
export function monthlyPeriodForDate(date: Date, startDay: number): MonthlyPeriod {
  const y = date.getFullYear()
  const m = date.getMonth()
  const d = date.getDate()
  const startThisMonth = clampDayToMonth(y, m, startDay)

  // Find the start month/year: this month if we're on/after its start, else prev.
  const startMY = d >= startThisMonth ? { year: y, month0: m } : addMonth0(y, m, -1)
  const start = new Date(startMY.year, startMY.month0, clampDayToMonth(startMY.year, startMY.month0, startDay))

  const nextMY = addMonth0(startMY.year, startMY.month0, 1)
  const nextStart = new Date(nextMY.year, nextMY.month0, clampDayToMonth(nextMY.year, nextMY.month0, startDay))
  const end = new Date(nextStart)
  end.setDate(end.getDate() - 1)

  return {
    start,
    end,
    startYMD: formatYMD(start),
    endYMD: formatYMD(end),
    name: `${MONTHS_SHORT[end.getMonth()]} ${end.getFullYear()}`,
    rangeLabel: `${fmt(start)} → ${fmt(end)}`,
    key: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`,
  }
}

/** The period immediately after the one containing `date`. */
export function nextMonthlyPeriod(date: Date, startDay: number): MonthlyPeriod {
  const current = monthlyPeriodForDate(date, startDay)
  const dayAfter = new Date(current.end)
  dayAfter.setDate(dayAfter.getDate() + 1)
  return monthlyPeriodForDate(dayAfter, startDay)
}

/**
 * Automatically generate `count` consecutive periods starting from the one that
 * contains `fromDate` (requirement #5 — no manual period creation needed).
 */
export function generateMonthlyPeriods(fromDate: Date, startDay: number, count: number): MonthlyPeriod[] {
  const out: MonthlyPeriod[] = []
  let cursor = new Date(fromDate)
  for (let i = 0; i < Math.max(0, count); i++) {
    const p = monthlyPeriodForDate(cursor, startDay)
    out.push(p)
    cursor = new Date(p.end)
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

// ─── payroll & credit derived events ─────────────────────────────────────────

export interface PayrollPeriodInfo extends MonthlyPeriod {
  /** Settlement month = the calendar month AFTER the period start month. */
  processingDate: Date
  paymentDate: Date
  lockDate: Date
}

export function payrollPeriodForDate(date: Date, fields: BusinessPeriodFields): PayrollPeriodInfo {
  const base = monthlyPeriodForDate(date, fields.payrollStartDay)
  // Settlement month = month after the period's START month.
  const settle = addMonth0(base.start.getFullYear(), base.start.getMonth(), 1)
  const on = (day: number) => new Date(settle.year, settle.month0, clampDayToMonth(settle.year, settle.month0, day))
  return {
    ...base,
    processingDate: on(fields.payrollProcessingDay),
    paymentDate: on(fields.payrollPaymentDay),
    lockDate: on(fields.payrollLockDay),
  }
}

export interface CreditCycleInfo extends MonthlyPeriod {
  /** When the credit limit next resets (start of the next cycle, on resetDay). */
  resetDate: Date
  /** Last day a balance may be settled before it is overdue (end + graceDays). */
  graceEndDate: Date
}

export function creditCycleForDate(date: Date, fields: BusinessPeriodFields): CreditCycleInfo {
  const base = monthlyPeriodForDate(date, fields.creditStartDay)
  const nextMY = addMonth0(base.start.getFullYear(), base.start.getMonth(), 1)
  const resetDate = new Date(nextMY.year, nextMY.month0, clampDayToMonth(nextMY.year, nextMY.month0, fields.creditResetDay))
  const graceEndDate = new Date(base.end)
  graceEndDate.setDate(graceEndDate.getDate() + fields.creditGraceDays)
  return { ...base, resetDate, graceEndDate }
}

// ─── validation ──────────────────────────────────────────────────────────────

/** Returns human-readable problems (empty = valid). */
export function validateBusinessPeriodFields(fields: BusinessPeriodFields): string[] {
  const problems: string[] = []
  const dayFields: [keyof BusinessPeriodFields, string][] = [
    ['businessMonthStartDay', 'Business month start day'],
    ['financialMonthStartDay', 'Financial month start day'],
    ['payrollStartDay', 'Payroll start day'],
    ['payrollProcessingDay', 'Payroll processing day'],
    ['payrollPaymentDay', 'Salary payment day'],
    ['payrollLockDay', 'Payroll lock day'],
    ['creditStartDay', 'Credit cycle start day'],
    ['creditResetDay', 'Credit limit reset day'],
  ]
  for (const [k, label] of dayFields) {
    const v = fields[k]
    if (!Number.isInteger(v) || v < 1 || v > 31) problems.push(`${label} must be a day between 1 and 31.`)
  }
  if (!Number.isInteger(fields.creditGraceDays) || fields.creditGraceDays < 0 || fields.creditGraceDays > 90) {
    problems.push('Credit grace period must be between 0 and 90 days.')
  }
  return problems
}

/** Non-blocking advisories the UI can surface (e.g. short-month clamping). */
export function businessPeriodWarnings(fields: BusinessPeriodFields): string[] {
  const warnings: string[] = []
  const over28 = Object.entries(fields).filter(([k, v]) => k.endsWith('Day') && typeof v === 'number' && v > 28)
  if (over28.length) {
    warnings.push('Day values above 28 are automatically clamped to the last day in shorter months (e.g. day 31 becomes 28 or 29 in February).')
  }
  return warnings
}

/** True if `startDay` produces plain calendar months (used for "unchanged" hints). */
export function isCalendarMonth(startDay: number): boolean {
  return startDay === 1
}

export { MONTHS_LONG, MONTHS_SHORT }
