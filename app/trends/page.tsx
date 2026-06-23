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
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid } from 'recharts'

type Grain = 'month' | 'quarter' | 'year'
type CompareMode = 'sequential' | 'yoy'
const GRAINS: { key: Grain; label: string }[] = [
  { key: 'month', label: 'Monthly' }, { key: 'quarter', label: 'Quarterly' }, { key: 'year', label: 'Yearly' },
]
interface SeriesRow { label: string; collected: number; systemSales: number }
interface Data {
  grain: Grain; compareMode: CompareMode
  current: { label: string; collected: number; systemSales: number }
  compare: { label: string; collected: number; systemSales: number }
  delta: { collectedPct: number; systemSalesPct: number; collectedAbs: number }
  series: SeriesRow[]
}

// "vs previous Qn" / "vs same period last year" wording per grain + mode.
const compareWord = (grain: Grain, mode: CompareMode) =>
  mode === 'yoy' ? 'vs same period last year' : `vs previous ${grain === 'month' ? 'month' : grain === 'quarter' ? 'quarter' : 'year'}`

function DeltaPill({ pct }: { pct: number }) {
  const up = pct >= 0
  return <span className={`text-sm font-bold ${up ? 'text-green-600' : 'text-red-600'}`}>{up ? '▲' : '▼'} {Math.abs(pct)}%</span>
}

export default function TrendsPage() {
  const { request } = useApi()
  // Honor an incoming scope from the Analytics hub (?grain&outletId).
  const initial = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const urlGrain = (['month', 'quarter', 'year'].includes(initial?.get('grain') || '') ? initial!.get('grain') : 'quarter') as Grain
  const urlOutlet = initial?.get('outletId') || ''
  const [grain, setGrain] = useState<Grain>(urlGrain)
  const [compareMode, setCompareMode] = useState<CompareMode>('sequential')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ grain, compare: compareMode })
      if (urlOutlet) qs.set('outletId', urlOutlet)
      setData(await request(`/api/reports/trends?${qs}`))
    } finally { setLoading(false) }
  }, [request, grain, compareMode, urlOutlet])

  useEffect(() => { load() }, [load])

  const hasData = data && data.series.some((s) => s.collected > 0 || s.systemSales > 0)
  const exportRows = (data?.series || []).map((s) => ({ Period: s.label, Collected: s.collected, 'System Sales': s.systemSales }))

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Trends</h1>
            <p className="text-gray-500 text-sm">Period-over-period growth — MoM, QoQ and year-over-year</p>
          </div>
          <ExportBar rows={exportRows} filename="trends" title="Trends" />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-600 mr-1">Grain:</span>
          {GRAINS.map((g) => (
            <button key={g.key} onClick={() => setGrain(g.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${grain === g.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{g.label}</button>
          ))}
          <div className="ml-auto flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            {([['sequential', 'Previous period'], ['yoy', 'Year-over-year']] as [CompareMode, string][]).map(([m, lbl]) => (
              <button key={m} onClick={() => setCompareMode(m)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${compareMode === m ? 'bg-white text-indigo-700 shadow-sm' : 'text-gray-500'}`}>{lbl}</button>
            ))}
          </div>
        </div>

        {loading ? <Skeleton className="h-96 rounded-2xl" /> : !hasData ? (
          <Card><EmptyState icon="📈" title="Not enough data for this view" hint="Collections need to span more than one period to compare." /></Card>
        ) : data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Card>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-500">Collections · {data.current.label}</div>
                  <DeltaPill pct={data.delta.collectedPct} />
                </div>
                <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(data.current.collected)}</div>
                <div className="text-xs text-gray-400">{compareWord(grain, compareMode)} · {data.compare.label}: {formatCurrency(data.compare.collected)} ({data.delta.collectedAbs >= 0 ? '+' : ''}{formatCurrency(data.delta.collectedAbs)})</div>
              </Card>
              <Card>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-gray-500">System Sales · {data.current.label}</div>
                  <DeltaPill pct={data.delta.systemSalesPct} />
                </div>
                <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(data.current.systemSales)}</div>
                <div className="text-xs text-gray-400">{compareWord(grain, compareMode)} · {data.compare.label}: {formatCurrency(data.compare.systemSales)}</div>
              </Card>
            </div>

            <Card>
              <CardHeader title="Collections vs system sales by period" subtitle={`Trailing ${data.series.length} ${grain === 'month' ? 'months' : grain === 'quarter' ? 'quarters' : 'years'}`} />
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.series} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={48} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: '#f8fafc' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar name="Collected" dataKey="collected" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                  <Bar name="System Sales" dataKey="systemSales" fill="#d97706" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}
