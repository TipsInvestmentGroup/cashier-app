import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { computeActuals } from '@/lib/target-actuals'
import { targetLevels, targetDeptKey } from '@/lib/targets'
import { loadActiveTargets } from '@/lib/sales-targets'
import { parse, isValid, startOfWeek, endOfWeek } from 'date-fns'

/**
 * Unified staff leaderboard — one row per staff across their outlet's per-staff
 * targets, with each metric's % achievement and a blended overall score.
 * status: reward (overall ≥ 80%), letter (< ⅓), else on-track. Cashier-scoped.
 */
export async function GET(req: NextRequest) {
  const user = getAuthUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const outletId = readOutletScope(user, searchParams.get('outletId'))
  const period = searchParams.get('period') === 'monthly' ? 'monthly' : 'weekly'
  const days = Number(searchParams.get('days')) || 30
  const parseD = (s: string | null) => { if (!s) return null; const p = parse(s, 'yyyy-MM-dd', new Date()); return isValid(p) ? p : null }
  const from = parseD(searchParams.get('from')) || startOfWeek(new Date(), { weekStartsOn: 1 })
  const to = parseD(searchParams.get('to')) || endOfWeek(new Date(), { weekStartsOn: 1 })

  const [actuals, allTargets] = await Promise.all([computeActuals({ from, to, outletId }), loadActiveTargets()])

  type Metric = { department: string; unit: string; unitLabel?: string | null; actual: number; target: number; pct: number }
  const rows: { staff: string; outlet: string; overallPct: number; status: 'reward' | 'ontrack' | 'letter'; metrics: Metric[] }[] = []

  const perStaffByOutlet = new Map<string, typeof allTargets>()
  for (const t of allTargets.filter((t) => t.scope === 'Per Staff')) {
    perStaffByOutlet.set(t.outletId, [...(perStaffByOutlet.get(t.outletId) || []), t])
  }

  for (const [oid, targets] of perStaffByOutlet) {
    const o = actuals.outlets.find((x) => x.id === oid)
    if (!o) continue
    const staff = actuals.byStaff[o.id] || []
    for (const s of staff) {
      const metrics: Metric[] = targets.map((t) => {
        const dk = targetDeptKey(t.department)
        const actual = dk === 'shisha' ? s.shisha : dk === 'food' ? s.food : s.collection
        const lv = targetLevels(t, period, days)
        return { department: t.department, unit: t.unit, unitLabel: t.unitLabel, actual, target: lv.target, pct: lv.target > 0 ? Math.round((actual / lv.target) * 100) : 0 }
      })
      if (metrics.every((m) => m.actual === 0)) continue
      const overallPct = Math.round(metrics.reduce((a, m) => a + m.pct, 0) / metrics.length)
      const status = overallPct >= 80 ? 'reward' : overallPct < 34 ? 'letter' : 'ontrack'
      rows.push({ staff: s.staffName, outlet: o.name, overallPct, status, metrics })
    }
  }
  rows.sort((a, b) => b.overallPct - a.overallPct)
  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }))

  return NextResponse.json({ rows: ranked, rewardCount: ranked.filter((r) => r.status === 'reward').length })
}
