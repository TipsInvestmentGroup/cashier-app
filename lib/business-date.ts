import { startOfDay, subDays } from 'date-fns'

/**
 * The daily collections/close-day lifecycle already keys everything (dedup,
 * DayClosure, reports) off a calendar-day `date` column — the only bug is
 * that "today" gets computed from the raw clock instead of the shift's
 * actual business day. A cashier entering data at 1am for an evening shift
 * that started the night before should land on yesterday's date, not
 * today's. This is the one place that decides the cutover.
 */
export function resolveBusinessDate(now: Date, cutoverHour: number): Date {
  const d = now.getHours() < cutoverHour ? subDays(now, 1) : now
  return startOfDay(d)
}
