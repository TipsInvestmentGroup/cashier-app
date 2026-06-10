import {
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, isWithinInterval, parseISO,
} from 'date-fns'

export type RangeKey = 'today' | 'week' | 'month' | 'custom'

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
]

export function getRangeInterval(range: RangeKey, customFrom: string, customTo: string): { start: Date; end: Date } {
  const now = new Date()
  switch (range) {
    case 'today':
      return { start: startOfDay(now), end: endOfDay(now) }
    case 'week':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
    case 'month':
      return { start: startOfMonth(now), end: endOfMonth(now) }
    case 'custom':
      return { start: startOfDay(parseISO(customFrom)), end: endOfDay(parseISO(customTo)) }
  }
}

/** Returns true if an ISO date string falls within the given range. */
export function inRange(isoDate: string, range: RangeKey, customFrom: string, customTo: string): boolean {
  try {
    return isWithinInterval(parseISO(isoDate), getRangeInterval(range, customFrom, customTo))
  } catch {
    return false
  }
}
