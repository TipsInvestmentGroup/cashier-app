import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser, readOutletScope } from '@/lib/auth'
import { computeActuals } from '@/lib/target-actuals'
import { TARGETS, targetLevels } from '@/lib/targets'
import { parse, isValid, startOfWeek, endOfWeek } from 'date-fns'

/**
 * Staff due a warning letter — per-staff targets where the NET actual is below
 * ⅓ of target for the window (defaults to the current week). Cashier-scoped.
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

  const actuals = await computeActuals({ from, to, outletId })

  const flagged: { staff: string; outlet: string; department: string; unit: string; actual: number; target: number; threshold: number }[] = []
  for (const g of ['Mikocheni', 'Coco'] as const) {
    const o = actuals.outlets.find((x) => x.name.toLowerCase().includes(g.toLowerCase()))
    if (!o) continue
    const staff = actuals.byStaff[o.id] || []
    for (const t of TARGETS.filter((x) => x.outlet === g && x.scope === 'Per Staff')) {
      const lv = targetLevels(t, period, days)
      const dk: 'shisha' | 'food' | 'collection' = t.department === 'Shisha Sales' ? 'shisha' : t.department === 'Food Sales' ? 'food' : 'collection'
      for (const s of staff) {
        const actual = dk === 'shisha' ? s.shisha : dk === 'food' ? s.food : s.collection
        if (actual > 0 && actual < lv.letterBelow) {
          flagged.push({ staff: s.staffName, outlet: o.name, department: t.department, unit: t.unit, actual, target: lv.target, threshold: lv.letterBelow })
        }
      }
    }
  }
  flagged.sort((a, b) => a.staff.localeCompare(b.staff))

  return NextResponse.json({ count: flagged.length, staffCount: new Set(flagged.map((f) => f.staff.toLowerCase())).size, flagged, from, to, period })
}
