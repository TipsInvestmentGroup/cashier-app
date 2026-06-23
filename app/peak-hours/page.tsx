'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { ExportBar } from '@/components/ExportBar'
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays } from 'date-fns'

type RangeKey = 'week' | 'month' | '30d' | 'custom'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'week', label: 'This Week' }, { key: 'month', label: 'This Month' }, { key: '30d', label: 'Last 30 Days' }, { key: 'custom', label: 'Custom' },
]
type Metric = 'orders' | 'revenue'
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

interface Data {
  orderGrid: number[][]; revenueGrid: number[][]
  peak: { dow: number; hour: number; orders: number; revenue: number }
  totalOrders: number; totalRevenue: number; days: number
}

// Indigo ramp for heat intensity (0 = empty/grey).
function cellColor(ratio: number): string {
  if (ratio <= 0) return '#f8fafc'
  const stops = ['#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca']
  return stops[Math.min(stops.length - 1, Math.floor(ratio * stops.length))]
}
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? 'a' : 'p'}`

export default function PeakHoursPage() {
  const { request } = useApi()
  // Honor an incoming scope from the Analytics hub (?from&to&outletId).
  const initial = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const urlFrom = initial?.get('from') || null
  const urlTo = initial?.get('to') || null
  const urlOutlet = initial?.get('outletId') || ''
  const [range, setRange] = useState<RangeKey>(urlFrom && urlTo ? 'custom' : '30d')
  const [metric, setMetric] = useState<Metric>('orders')
  const [customFrom, setCustomFrom] = useState(urlFrom || format(subDays(new Date(), 29), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(urlTo || format(new Date(), 'yyyy-MM-dd'))
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  const interval = (() => {
    const now = new Date()
    switch (range) {
      case 'week': return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
      case 'month': return { start: startOfMonth(now), end: endOfMonth(now) }
      case '30d': return { start: subDays(now, 29), end: now }
      case 'custom': return { start: new Date(customFrom), end: new Date(customTo) }
    }
  })()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from: format(interval.start, 'yyyy-MM-dd'), to: format(interval.end, 'yyyy-MM-dd') })
      if (urlOutlet) qs.set('outletId', urlOutlet)
      const r = await request(`/api/reports/peak-heatmap?${qs}`)
      setData(r)
    } finally { setLoading(false) }
  }, [request, range, customFrom, customTo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const grid = data ? (metric === 'orders' ? data.orderGrid : data.revenueGrid) : []
  const max = grid.reduce((m, row) => Math.max(m, ...row), 0)
  const fmt = (v: number) => (metric === 'orders' ? String(v) : formatCurrency(v))
  // Only the busiest working hours matter for staffing; trim dead early-morning hours.
  const hours = Array.from({ length: 24 }, (_, h) => h).filter((h) => grid.some((row) => row[h] > 0))
  const shownHours = hours.length ? hours : Array.from({ length: 18 }, (_, i) => i + 6) // 6a–11p fallback

  // Per-weekday and per-hour totals for the margins.
  const dowTotals = grid.map((row) => row.reduce((s, v) => s + v, 0))
  const hourTotals = shownHours.map((h) => grid.reduce((s, row) => s + row[h], 0))

  const exportRows = grid.flatMap((row, d) =>
    shownHours.filter((h) => row[h] > 0).map((h) => ({ Weekday: DOW[d], Hour: hourLabel(h), [metric === 'orders' ? 'Orders' : 'Revenue']: row[h] }))
  )

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Peak Hours</h1>
            <p className="text-gray-500 text-sm">Order volume by weekday × hour (EAT) — use it to plan staffing</p>
          </div>
          <ExportBar rows={exportRows} filename="peak-hours" title="Peak Hours" />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-600 mr-1">Period:</span>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${range === r.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{r.label}</button>
          ))}
          {range === 'custom' && (
            <div className="flex items-center gap-2 ml-1">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          )}
          <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            {(['orders', 'revenue'] as Metric[]).map((m) => (
              <button key={m} onClick={() => setMetric(m)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition ${metric === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>{m}</button>
            ))}
          </div>
        </div>

        {loading ? <Skeleton className="h-96 rounded-2xl" /> : !data || data.totalOrders === 0 ? (
          <Card><EmptyState icon="🕒" title="No POS orders in this period" hint="The heatmap is built from POS order timestamps." /></Card>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Card><div className="text-xs text-gray-500">Busiest slot</div><div className="text-lg font-bold text-gray-900">{DOW[data.peak.dow]} · {hourLabel(data.peak.hour)}</div><div className="text-xs text-indigo-600">{data.peak.orders} orders · {formatCurrency(data.peak.revenue)}</div></Card>
              <Card><div className="text-xs text-gray-500">Total orders</div><div className="text-lg font-bold text-gray-900">{data.totalOrders.toLocaleString()}</div><div className="text-xs text-gray-400">over {data.days} day(s)</div></Card>
              <Card><div className="text-xs text-gray-500">Total revenue</div><div className="text-lg font-bold text-gray-900">{formatCurrency(data.totalRevenue)}</div><div className="text-xs text-gray-400">{Math.round(data.totalOrders / data.days)} orders/day avg</div></Card>
            </div>

            <Card>
              <CardHeader title={metric === 'orders' ? 'Orders by weekday × hour' : 'Revenue by weekday × hour'} subtitle="Darker = busier · East Africa Time" />
              <div className="overflow-x-auto">
                <table className="border-separate" style={{ borderSpacing: 3 }}>
                  <thead>
                    <tr>
                      <th className="w-10"></th>
                      {shownHours.map((h) => (
                        <th key={h} className="text-[10px] font-medium text-gray-400 px-0.5 text-center min-w-[34px]">{hourLabel(h)}</th>
                      ))}
                      <th className="text-[10px] font-semibold text-gray-500 pl-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DOW.map((d, di) => (
                      <tr key={d}>
                        <td className="text-xs font-semibold text-gray-600 pr-2 text-right">{d}</td>
                        {shownHours.map((h) => {
                          const v = grid[di][h]
                          const ratio = max > 0 ? v / max : 0
                          return (
                            <td key={h} title={`${d} ${hourLabel(h)} — ${fmt(v)}`}
                              className="rounded-md text-center align-middle h-9 min-w-[34px] text-[10px] font-semibold"
                              style={{ backgroundColor: cellColor(ratio), color: ratio > 0.5 ? '#fff' : ratio > 0 ? '#3730a3' : '#cbd5e1' }}>
                              {v > 0 ? (metric === 'orders' ? v : Math.round(v / 1000) + 'k') : ''}
                            </td>
                          )
                        })}
                        <td className="text-xs font-bold text-gray-700 pl-2 text-right">{metric === 'orders' ? dowTotals[di] : formatCurrency(dowTotals[di])}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="text-[10px] font-semibold text-gray-500 pr-2 text-right">Total</td>
                      {shownHours.map((h, hi) => (
                        <td key={h} className="text-[10px] font-bold text-gray-600 text-center">{metric === 'orders' ? hourTotals[hi] : Math.round(hourTotals[hi] / 1000) + 'k'}</td>
                      ))}
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] text-gray-400">Built from POS order timestamps (excludes cancelled/void). Hours with no activity across all days are hidden.</p>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}
