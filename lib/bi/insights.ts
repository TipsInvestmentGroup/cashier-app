// Rule-based Insights Engine — turns BI-layer figures into the "what
// happened / is it good or bad / what to do" text dashboards render under an
// existing stat card. Deterministic and DB-free by design (offline-first,
// instant, no external dependency): every function here takes already-fetched
// numbers/rows and returns a small structured object; nothing here queries
// Prisma. Comparison math reuses lib/periods.ts's pctChange rather than
// re-deriving it a third time.
import { pctChange } from '@/lib/periods'
import { targetLevels } from '@/lib/targets'

export type InsightStatus = 'good' | 'bad' | 'neutral'

export interface ComparisonInsight {
  pctChange: number
  direction: 'up' | 'down' | 'flat'
  status: InsightStatus
  text: string
}

/**
 * Generic period-over-period comparison (DoD/WoW/MoM are all this same
 * shape — only the label and which two numbers you pass in differ).
 * `higherIsBetter` flips good/bad (e.g. Sales up = good, Loss up = bad).
 */
export function compare(current: number, previous: number, label: string, higherIsBetter = true): ComparisonInsight {
  const pct = pctChange(current, previous)
  const direction = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat'
  const status: InsightStatus = pct === 0 ? 'neutral' : (pct > 0) === higherIsBetter ? 'good' : 'bad'
  const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '—'
  const text = direction === 'flat'
    ? `Flat vs ${label}`
    : `${arrow} ${Math.abs(pct)}% ${direction === 'up' ? 'higher' : 'lower'} than ${label}`
  return { pctChange: pct, direction, status, text }
}

export interface TargetInsight {
  pct: number
  remaining: number
  status: 'exceeded' | 'on-track' | 'below'
  text: string
}

/** Target-vs-Achievement — reuses lib/targets.ts's derivation math, not a re-implementation. */
export function targetAchievement(actual: number, weeklyTarget: number | null, period: 'daily' | 'weekly' = 'daily'): TargetInsight | null {
  if (weeklyTarget == null || weeklyTarget <= 0) return null
  const target = period === 'daily' ? Math.round(weeklyTarget / 7) : targetLevels({ weeklyTarget }, 'weekly').target
  if (target <= 0) return null
  const pct = Math.round((actual / target) * 100)
  const remaining = Math.max(0, Math.round(target - actual))
  const status: TargetInsight['status'] = pct >= 100 ? 'exceeded' : pct >= 80 ? 'on-track' : 'below'
  const text = pct >= 100
    ? `Target achieved (${pct}%)`
    : `${pct}% of target — ${remaining.toLocaleString()} remaining`
  return { pct, remaining, status, text }
}

export interface PeakHourBucket { hour: number; label: string; amount: number }

/** Best-performing hour bucket, from already-computed hourly buckets (see lib/staff-analytics.ts's getHourlyBreakdown). */
export function peakHourInsight(buckets: PeakHourBucket[]): { label: string; text: string } | null {
  if (!buckets.length) return null
  const peak = buckets.reduce((a, b) => (b.amount > a.amount ? b : a))
  return { label: peak.label, text: `Peak hour: ${peak.label}` }
}

export interface LossAttributionInsight {
  dominant: 'cancellations' | 'discounts' | 'unpaid-signed-bills' | 'none'
  text: string
  recommendation?: string
}

/** Which component drove today's loss, with a fixed-phrasing recommendation. */
export function lossAttribution(session: {
  cancellations: number
  discounts: number
  signedBillsTotal: number
  dailyLoss: number
}): LossAttributionInsight {
  if (session.dailyLoss <= 0) return { dominant: 'none', text: 'No loss recorded' }

  const candidates: { key: LossAttributionInsight['dominant']; amount: number; recommendation: string }[] = [
    { key: 'cancellations', amount: session.cancellations, recommendation: 'Review cancellation approvals.' },
    { key: 'discounts', amount: session.discounts, recommendation: 'Review discount policy.' },
    { key: 'unpaid-signed-bills', amount: session.signedBillsTotal, recommendation: 'Review unpaid signed bills.' },
  ]
  const top = candidates.reduce((a, b) => (b.amount > a.amount ? b : a))
  if (top.amount <= 0) return { dominant: 'none', text: `Loss of ${Math.round(session.dailyLoss).toLocaleString()} — cause not attributable to cancellations, discounts, or signed bills` }

  const causeLabel = top.key === 'cancellations' ? 'Cancelled Bills' : top.key === 'discounts' ? 'Discounts' : 'Unpaid Signed Bills'
  return { dominant: top.key, text: `Main cause: ${causeLabel}`, recommendation: top.recommendation }
}

export type TrendDirection = 'improving' | 'stable' | 'declining'

/** Simple slope check over a trailing series — improving/stable/declining. */
export function trendLabel(series: number[]): TrendDirection {
  if (series.length < 2) return 'stable'
  const mid = Math.floor(series.length / 2)
  const firstHalf = series.slice(0, mid)
  const secondHalf = series.slice(mid)
  const avg = (rows: number[]) => rows.reduce((s, v) => s + v, 0) / (rows.length || 1)
  const a = avg(firstHalf)
  const b = avg(secondHalf)
  if (a === 0) return b > 0 ? 'improving' : 'stable'
  const change = ((b - a) / a) * 100
  if (change > 5) return 'improving'
  if (change < -5) return 'declining'
  return 'stable'
}
