// Client-safe Aging formatter for the Expense Requests table (Phase 3). The
// value is computed at RENDER time from stageEnteredAt (never stored), so it is
// always current without a background job. Thresholds per spec: green < 24h,
// amber 1–3 days, red > 3 days.

export type AgingTone = 'green' | 'amber' | 'red'

export interface Aging {
  /** e.g. "3 Hours", "2 Days", "45 Minutes". */
  label: string
  tone: AgingTone
  hours: number
}

/**
 * Time since a request entered its current status. `from` is stageEnteredAt
 * (falls back to createdAt for pre-Phase-3 rows that were backfilled, or if a
 * caller passes it). `nowMs` is injectable for deterministic tests. Returns null
 * for a missing timestamp so the caller can render a plain dash.
 */
export function computeAging(from: string | Date | null | undefined, nowMs: number = Date.now()): Aging | null {
  if (!from) return null
  const started = typeof from === 'string' ? Date.parse(from) : from.getTime()
  if (Number.isNaN(started)) return null

  const ms = Math.max(0, nowMs - started)
  const minutes = Math.floor(ms / 60000)
  const hours = ms / 3600000
  const days = Math.floor(hours / 24)

  let label: string
  if (minutes < 60) label = `${minutes} ${minutes === 1 ? 'Minute' : 'Minutes'}`
  else if (hours < 24) { const h = Math.floor(hours); label = `${h} ${h === 1 ? 'Hour' : 'Hours'}` }
  else label = `${days} ${days === 1 ? 'Day' : 'Days'}`

  // green < 24h · amber 1–3 days · red > 3 days.
  const tone: AgingTone = hours < 24 ? 'green' : days <= 3 ? 'amber' : 'red'
  return { label, tone, hours }
}
