'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { StatCard } from '@/components/ui/StatCard'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatCardsSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { ExportBar } from '@/components/ExportBar'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'

type RangeKey = 'today' | 'week' | 'month' | 'custom'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This Week' }, { key: 'month', label: 'This Month' }, { key: 'custom', label: 'Custom' },
]
interface Outlet { id: string; name: string }
interface Row {
  staff: string; days: number; systemSales: number; collected: number; creditIssued: number
  discount: number; cancellations: number; collectionRate: number; loss: number; excess: number; net: number
}

export default function StaffScorecardPage() {
  const { request } = useApi()
  const [range, setRange] = useState<RangeKey>('month')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [totals, setTotals] = useState({ systemSales: 0, collected: 0, loss: 0, excess: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => { request('/api/outlets').then(setOutlets).catch(() => {}) }, [request])

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
      if (outletId) qs.set('outletId', outletId)
      const r = await request(`/api/reports/staff-scorecard?${qs}`)
      setRows(r.rows || []); setTotals(r.totals || { systemSales: 0, collected: 0, loss: 0, excess: 0 })
    } finally { setLoading(false) }
  }, [request, range, customFrom, customTo, outletId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const exportRows = rows.map((r) => ({
    Staff: r.staff, Days: r.days, 'System Sales': r.systemSales, Collected: r.collected,
    'Collection %': r.collectionRate, 'Credit Issued': r.creditIssued, Cancellations: r.cancellations,
    Loss: r.loss, Excess: r.excess,
  }))

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Staff Scorecard</h1>
            <p className="text-gray-500 text-sm">Per-staff sales, collection rate, shortfalls and excess</p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            {!outlets.length ? null : (
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
                className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
                <option value="">All Outlets</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <ExportBar rows={exportRows} filename="staff-scorecard" title="Staff Scorecard" />
          </div>
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

        {loading ? (
          <><StatCardsSkeleton count={4} /><Skeleton className="h-64 rounded-2xl" /></>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard icon="🧾" label="System Sales" value={formatCurrency(totals.systemSales)} />
              <StatCard icon="💰" label="Collected" value={formatCurrency(totals.collected)} sub={totals.systemSales > 0 ? `${Math.round((totals.collected / totals.systemSales) * 100)}% of system` : undefined} />
              <StatCard icon="🔻" label="Total Loss" value={formatCurrency(totals.loss)} color="bg-gradient-to-br from-red-500 to-red-600 text-white" />
              <StatCard icon="🔺" label="Total Excess" value={formatCurrency(totals.excess)} color="bg-gradient-to-br from-green-500 to-green-600 text-white" />
            </div>

            <Card className="p-0 overflow-hidden">
              {rows.length === 0 ? (
                <EmptyState icon="🧑‍💼" title="No staff activity in this period" hint="Record collections to see staff performance." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left text-gray-600">
                        <th className="px-4 py-3 font-semibold">Staff</th>
                        <th className="px-4 py-3 font-semibold text-center">Days</th>
                        <th className="px-4 py-3 font-semibold text-right">System Sales</th>
                        <th className="px-4 py-3 font-semibold text-right">Collected</th>
                        <th className="px-4 py-3 font-semibold text-center">Collection %</th>
                        <th className="px-4 py-3 font-semibold text-right">Credit</th>
                        <th className="px-4 py-3 font-semibold text-right">Cancel.</th>
                        <th className="px-4 py-3 font-semibold text-right">Loss / Excess</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rows.map((r) => (
                        <tr key={r.staff} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-800">{r.staff}</td>
                          <td className="px-4 py-3 text-center text-gray-500">{r.days}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(r.systemSales)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(r.collected)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge tone={r.collectionRate >= 95 ? 'green' : r.collectionRate >= 80 ? 'amber' : 'red'}>{r.collectionRate}%</Badge>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-500">{r.creditIssued ? formatCurrency(r.creditIssued) : '-'}</td>
                          <td className="px-4 py-3 text-right text-gray-500">{r.cancellations ? formatCurrency(r.cancellations) : '-'}</td>
                          <td className={`px-4 py-3 text-right font-bold ${r.loss > 0 ? 'text-red-600' : r.excess > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                            {r.loss > 0 ? `▼ ${formatCurrency(r.loss)}` : r.excess > 0 ? `▲ ${formatCurrency(r.excess)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}
