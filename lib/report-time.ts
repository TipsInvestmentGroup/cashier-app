// The single source of truth for bucketing report data into East Africa Time.
//
// The WRITE side stamps a business day; the READ side must bucket the same way,
// but raw `new Date().getHours()` / date-fns run in the SERVER's timezone — on a
// UTC production host that shifts every hour/day three hours and lands late-night
// activity on the wrong day (invisible on a local EAT machine). Tanzania has no
// DST, so EAT is a fixed UTC+3: shifting the UTC instant by +3h and reading its
// UTC parts gives correct EAT wall-clock values regardless of the host timezone.
//
// Use these helpers for every report bucket and date-range instead of bare
// getHours()/startOfDay(). Belt-and-suspenders: also set the deploy timezone
// (TZ=Africa/Nairobi) so any incidental server-local date math agrees.
export const EAT_OFFSET_MS = 3 * 60 * 60 * 1000

/** The UTC instant `d`, shifted so its getUTC* fields read as EAT wall-clock. */
function eatWall(d: Date): Date {
  return new Date(d.getTime() + EAT_OFFSET_MS)
}

/** Hour-of-day 0–23 in EAT. */
export const localHour = (d: Date): number => eatWall(d).getUTCHours()

/** EAT day-of-week, 0 = Sunday … 6 = Saturday. */
export const localDayOfWeek = (d: Date): number => eatWall(d).getUTCDay()

/** EAT calendar date key, "yyyy-MM-dd". */
export function localDateKey(d: Date): string {
  const w = eatWall(d)
  return `${w.getUTCFullYear()}-${String(w.getUTCMonth() + 1).padStart(2, '0')}-${String(w.getUTCDate()).padStart(2, '0')}`
}

/** EAT month key, "yyyy-MM". */
export function localMonthKey(d: Date): string {
  const w = eatWall(d)
  return `${w.getUTCFullYear()}-${String(w.getUTCMonth() + 1).padStart(2, '0')}`
}

/** EAT date key of the start of `d`'s week (weekStartsOn: 0=Sun … default 1=Mon). */
export function localWeekStartKey(d: Date, weekStartsOn = 1): string {
  const w = eatWall(d)
  const dow = w.getUTCDay()
  const diff = (dow - weekStartsOn + 7) % 7
  const start = new Date(w.getTime() - diff * 86_400_000)
  return `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-${String(start.getUTCDate()).padStart(2, '0')}`
}

/** UTC {gte, lte} instants bounding the EAT calendar day that contains `day`. */
export function eatDayRange(day: Date): { gte: Date; lte: Date } {
  const w = eatWall(day)
  const y = w.getUTCFullYear(), m = w.getUTCMonth(), d = w.getUTCDate()
  return {
    gte: new Date(Date.UTC(y, m, d, 0, 0, 0, 0) - EAT_OFFSET_MS),
    lte: new Date(Date.UTC(y, m, d, 23, 59, 59, 999) - EAT_OFFSET_MS),
  }
}

/** UTC {gte, lte} bounding the EAT week containing `day` (weekStartsOn default Mon). */
export function eatWeekRange(day: Date, weekStartsOn = 1): { gte: Date; lte: Date } {
  const w = eatWall(day)
  const diff = (w.getUTCDay() - weekStartsOn + 7) % 7
  const startWall = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() - diff, 0, 0, 0, 0))
  return {
    gte: new Date(startWall.getTime() - EAT_OFFSET_MS),
    lte: new Date(startWall.getTime() + 7 * 86_400_000 - 1 - EAT_OFFSET_MS),
  }
}

/** UTC {gte, lte} bounding the EAT calendar month containing `day`. */
export function eatMonthRange(day: Date): { gte: Date; lte: Date } {
  const w = eatWall(day)
  const y = w.getUTCFullYear(), m = w.getUTCMonth()
  return {
    gte: new Date(Date.UTC(y, m, 1, 0, 0, 0, 0) - EAT_OFFSET_MS),
    lte: new Date(Date.UTC(y, m + 1, 1, 0, 0, 0, 0) - EAT_OFFSET_MS - 1),
  }
}
