'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAnalyticsScope, PRESETS } from '@/hooks/useAnalyticsScope'
import { formatCurrency } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { TrendingUp, Clock, Building2, BarChart3, Landmark, FileBarChart, ShieldCheck, ArrowRight } from 'lucide-react'

interface OutletRow { outlet: string; systemSales: number; collected: number; signed: number; cancellations: number }
interface Outlet { id: string; name: string }

export default function AnalyticsHubPage() {
  const { request } = useApi()
  const scope = useAnalyticsScope()
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [rows, setRows] = useState<OutletRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { request('/api/outlets').then(setOutlets).catch(() => {}) }, [request])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await request(`/api/reports/outlet-comparison?${scope.query()}`)
      setRows(r.rows || [])
    } finally { setLoading(false) }
  }, [request, scope.fromStr, scope.toStr, scope.outletId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const totals = rows.reduce((a, r) => ({
    systemSales: a.systemSales + r.systemSales, collected: a.collected + r.collected,
    signed: a.signed + r.signed, cancellations: a.cancellations + r.cancellations,
  }), { systemSales: 0, collected: 0, signed: 0, cancellations: 0 })
  const collectionRate = totals.systemSales > 0 ? Math.round((totals.collected / totals.systemSales) * 100) : 0

  // Report cards — each carries the persistent scope into the linked report.
  const reports = [
    { href: `/trends?${scope.query({ grain: 'quarter' })}`, icon: TrendingUp, title: 'Trends', desc: 'MoM / QoQ / YoY growth', tone: 'bg-indigo-50 text-indigo-600' },
    { href: `/peak-hours?${scope.query()}`, icon: Clock, title: 'Peak Hours', desc: 'Weekday × hour for staffing', tone: 'bg-amber-50 text-amber-600' },
    { href: `/outlet-comparison?${scope.query()}`, icon: Building2, title: 'Outlet Comparison', desc: 'Side-by-side with growth', tone: 'bg-blue-50 text-blue-600' },
    { href: `/staff-scorecard?${scope.query()}`, icon: BarChart3, title: 'Staff Scorecard', desc: 'Per-staff performance', tone: 'bg-purple-50 text-purple-600' },
    { href: '/receivables', icon: Landmark, title: 'Receivables', desc: 'Outstanding by category', tone: 'bg-green-50 text-green-600' },
    { href: '/reports', icon: FileBarChart, title: 'Reports', desc: 'Daily & period reports', tone: 'bg-slate-100 text-slate-600' },
    { href: '/audit', icon: ShieldCheck, title: 'Audit Log', desc: 'Who changed what', tone: 'bg-red-50 text-red-600' },
  ]

  const kpis = [
    { label: 'System Sales', value: formatCurrency(totals.systemSales) },
    { label: 'Collected', value: formatCurrency(totals.collected) },
    { label: 'Collection Rate', value: `${collectionRate}%` },
    { label: 'Credit Issued', value: formatCurrency(totals.signed) },
  ]

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-gray-500 text-sm">One place for every report — set the period and outlet once, drill down anywhere</p>
        </div>

        {/* Persistent filter bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-600 mr-1">Period:</span>
          {PRESETS.map((p) => (
            <button key={p.key} onClick={() => scope.setPreset(p.key)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition ${scope.preset === p.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{p.label}</button>
          ))}
          {scope.preset === 'custom' && (
            <div className="flex items-center gap-2">
              <input type="date" value={scope.customFrom} onChange={(e) => scope.setCustom(e.target.value, scope.customTo)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" value={scope.customTo} onChange={(e) => scope.setCustom(scope.customFrom, e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          )}
          {outlets.length > 1 && (
            <select value={scope.outletId} onChange={(e) => scope.setOutlet(e.target.value)}
              className="ml-auto px-3 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium text-gray-700 focus:border-indigo-500 focus:outline-none">
              <option value="">All outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>

        {/* Headline KPIs for the chosen scope */}
        {loading ? <Skeleton className="h-24 rounded-2xl" /> : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {kpis.map((k) => (
              <Card key={k.label}><div className="text-xs text-gray-500">{k.label}</div><div className="text-xl font-bold text-gray-900 mt-1">{k.value}</div></Card>
            ))}
          </div>
        )}

        {/* Report drill-down cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {reports.map((r) => {
            const Icon = r.icon
            return (
              <Link key={r.title} href={r.href}
                className="group bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition flex items-start gap-4">
                <span className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${r.tone}`}><Icon className="w-5 h-5" /></span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 flex items-center gap-1">{r.title}<ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition" /></div>
                  <div className="text-sm text-gray-500">{r.desc}</div>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </AppShell>
  )
}
