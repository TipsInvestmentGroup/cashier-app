'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import { ExportBar } from '@/components/ExportBar'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'

type RangeKey = 'today' | 'week' | 'month' | 'custom'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This Week' }, { key: 'month', label: 'This Month' }, { key: 'custom', label: 'Custom' },
]
interface Row {
  outlet: string; systemSales: number; collected: number; collectionRate: number
  variance: number; signed: number; cancellations: number; growthPct: number
}

export default function OutletComparisonPage() {
  const { request } = useApi()
  // Honor an incoming scope from the Analytics hub (?from&to) as a custom range.
  const initial = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const urlFrom = initial?.get('from') || null
  const urlTo = initial?.get('to') || null
  const [range, setRange] = useState<RangeKey>(urlFrom && urlTo ? 'custom' : 'month')
  const [customFrom, setCustomFrom] = useState(urlFrom || format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(urlTo || format(new Date(), 'yyyy-MM-dd'))
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const interval = (() => {
    const now = new Date()
    switch (range) {
      case 'today': return { start: startOfDay(now), end: endOfDay(now) }
      case 'week': return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
      case 'month': return { start: startOfMonth(now), end: endOfMonth(now) }
      case 'custom': return { start: startOfDay(new Date(customFrom)), end: endOfDay(new Date(customTo)) }
    }
  })()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ from: format(interval.start, 'yyyy-MM-dd'), to: format(interval.end, 'yyyy-MM-dd') })
      const r = await request(`/api/reports/outlet-comparison?${qs}`)
      setRows(r.rows || [])
    } finally { setLoading(false) }
  }, [request, range, customFrom, customTo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const chartData = rows.map((r) => ({ name: r.outlet, System: r.systemSales, Collected: r.collected }))
  const exportRows = rows.map((r) => ({
    Outlet: r.outlet, 'System Sales': r.systemSales, Collected: r.collected, 'Collection %': r.collectionRate,
    Variance: r.variance, 'Credit Issued': r.signed, Cancellations: r.cancellations, 'Growth %': r.growthPct,
  }))

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Outlet Comparison</h1>
            <p className="text-gray-500 text-sm">Side-by-side outlet performance with growth vs the previous period</p>
          </div>
          <ExportBar rows={exportRows} filename="outlet-comparison" title="Outlet Comparison" />
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
        </div>

        {loading ? <Skeleton className="h-72 rounded-2xl" /> : rows.length === 0 ? (
          <Card><EmptyState icon="🏢" title="No outlet activity in this period" /></Card>
        ) : (
          <>
            <Card>
              <CardHeader title="System sales vs collected" subtitle="by outlet" />
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={48} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: '#f8fafc' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="System" fill="#d97706" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Collected" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2 text-left">Outlet</th>
                      <th className="px-4 py-2 text-right">System Sales</th>
                      <th className="px-4 py-2 text-right">Collected</th>
                      <th className="px-4 py-2 text-right">Collection %</th>
                      <th className="px-4 py-2 text-right">Variance</th>
                      <th className="px-4 py-2 text-right">Credit</th>
                      <th className="px-4 py-2 text-right">Cancel.</th>
                      <th className="px-4 py-2 text-right">Growth</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((r) => (
                      <tr key={r.outlet} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-semibold text-gray-800">{r.outlet}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(r.systemSales)}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{formatCurrency(r.collected)}</td>
                        <td className="px-4 py-2 text-right"><Badge tone={r.collectionRate >= 95 ? 'green' : r.collectionRate >= 80 ? 'amber' : 'red'}>{r.collectionRate}%</Badge></td>
                        <td className={`px-4 py-2 text-right font-medium ${r.variance < 0 ? 'text-red-600' : r.variance > 0 ? 'text-green-600' : 'text-gray-400'}`}>{formatCurrency(r.variance)}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{r.signed ? formatCurrency(r.signed) : '-'}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{r.cancellations ? formatCurrency(r.cancellations) : '-'}</td>
                        <td className={`px-4 py-2 text-right text-xs font-semibold ${r.growthPct > 0 ? 'text-green-600' : r.growthPct < 0 ? 'text-red-600' : 'text-gray-400'}`}>{r.growthPct > 0 ? '▲' : r.growthPct < 0 ? '▼' : '–'} {Math.abs(r.growthPct)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="px-4 py-2 text-[11px] text-gray-400">Growth compares Collected against the previous equal-length period.</p>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}
