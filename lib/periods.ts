import {
  startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear,
  subMonths, subQuarters, subYears, getQuarter, format,
} from 'date-fns'

// The period engine: resolves a "grain" (month/quarter/year) into a current
// window, a comparison window, and a trailing series — so reports can do
// MoM/QoQ/YoY without hand-rolling date math each time.

export type Grain = 'month' | 'quarter' | 'year'
export type CompareMode = 'sequential' | 'yoy'

export interface Window { start: Date; end: Date; label: string }
export interface ResolvedPeriod {
  grain: Grain
  compareMode: CompareMode
  current: Window
  compare: Window
  series: Window[] // trailing windows, oldest → newest, ending at current
}

const labelFor = (grain: Grain, d: Date): string => {
  switch (grain) {
    case 'month': return format(d, 'MMM yyyy')
    case 'quarter': return `Q${getQuarter(d)} ${format(d, 'yyyy')}`
    case 'year': return format(d, 'yyyy')
  }
}

const boundsFor = (grain: Grain, d: Date): Window => {
  switch (grain) {
    case 'month': return { start: startOfMonth(d), end: endOfMonth(d), label: labelFor('month', d) }
    case 'quarter': return { start: startOfQuarter(d), end: endOfQuarter(d), label: labelFor('quarter', d) }
    case 'year': return { start: startOfYear(d), end: endOfYear(d), label: labelFor('year', d) }
  }
}

// Step back `n` whole grains from a reference date.
const stepBack = (grain: Grain, d: Date, n: number): Date => {
  switch (grain) {
    case 'month': return subMonths(d, n)
    case 'quarter': return subQuarters(d, n)
    case 'year': return subYears(d, n)
  }
}

// How many trailing periods to chart per grain.
const SERIES_LEN: Record<Grain, number> = { month: 12, quarter: 8, year: 5 }

/**
 * Resolve a grain + comparison mode (relative to `ref`, default now) into the
 * current window, the comparison window, and a trailing series for charting.
 * - sequential: compare to the immediately-preceding period (MoM/QoQ/YoY-by-step)
 * - yoy: compare to the same period one year earlier
 */
export function resolvePeriod(grain: Grain, compareMode: CompareMode, ref: Date = new Date()): ResolvedPeriod {
  const current = boundsFor(grain, ref)
  const compareRef = compareMode === 'yoy' ? subYears(ref, 1) : stepBack(grain, ref, 1)
  const compare = boundsFor(grain, compareRef)

  const n = SERIES_LEN[grain]
  const series: Window[] = []
  for (let i = n - 1; i >= 0; i--) series.push(boundsFor(grain, stepBack(grain, ref, i)))

  return { grain, compareMode, current, compare, series }
}

export const pctChange = (cur: number, prev: number): number =>
  prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : cur > 0 ? 100 : 0
