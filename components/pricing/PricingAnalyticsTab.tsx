'use client'
import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrency } from '@/lib/utils'
import { format, startOfMonth } from 'date-fns'
import { TrendingUp, Percent, Scale, Package, Building2, Tag } from 'lucide-react'

interface Bucket { key: string; name: string; qty: number; revenue: number; cost: number; margin: number; marginPct: number; variance: number }
interface Analytics {
  kpis: { revenue: number; qty: number; cost: number; margin: number; marginPct: number; variance: number; lines: number }
  byProduct: Bucket[]; byOutlet: Bucket[]; byCategory: Bucket[]; byPriceList: Bucket[]
  outletOptions: { id: string; name: string }[]
}
const MGMT = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

export function PricingAnalyticsTab() {
  const { request } = useApi()
  const { user } = useAuth()
  const canPickOutlet = MGMT.includes(user?.role || '')
  const now = new Date()
  const [from, setFrom] = useState(format(startOfMonth(now), 'yyyy-MM-dd'))
  const [to, setTo] = useState(format(now, 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const qs = new URLSearchParams({ from, to }); if (outletId) qs.set('outletId', outletId); setData(await request(`/api/pricing/analytics?${qs}`)) }
    catch { setData(null) } finally { setLoading(false) }
  }, [request, from, to, outletId])
  useEffect(() => { load() }, [load])

  const k = data?.kpis
  const has = !!data && data.kpis.lines > 0
  const inp = 'px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none'

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-3">
        <div><label className="block text-xs font-semibold text-gray-600 mb-1">From</label><input type="date" className={inp} value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><label className="block text-xs font-semibold text-gray-600 mb-1">To</label><input type="date" className={inp} value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {canPickOutlet && <div><label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label><select className={`${inp} bg-white`} value={outletId} onChange={(e) => setOutletId(e.target.value)}><option value="">All outlets</option>{(data?.outletOptions || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>}
        <p className="text-[11px] text-gray-400 ml-auto self-center">Approved sales only. Variance = actual − Price-List expected. Margin = actual − cost.</p>
      </div>

      {loading && <p className="text-sm text-indigo-500 animate-pulse">Loading…</p>}
      {!loading && !has && <div className="bg-white rounded-2xl shadow-sm border border-gray-100"><EmptyState icon="📈" title="No approved sales in range" hint="Approve a sales import (with matched products) to see revenue, margin and price-variance analytics." /></div>}

      {!loading && has && k && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi icon={TrendingUp} label="Revenue" value={formatCurrency(k.revenue)} wide />
            <Kpi icon={Scale} label="Margin" value={formatCurrency(k.margin)} tone={k.margin < 0 ? 'red' : 'green'} />
            <Kpi icon={Percent} label="Margin %" value={`${k.marginPct}%`} tone={k.marginPct < 0 ? 'red' : undefined} />
            <Kpi icon={Package} label="Items sold" value={k.qty.toLocaleString()} />
            <Kpi icon={TrendingUp} label="Cost" value={formatCurrency(k.cost)} />
            <Kpi icon={Scale} label="Price variance" value={formatCurrency(k.variance)} tone={Math.abs(k.variance) > 0 ? 'amber' : undefined} />
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <DimTable title="By product" icon={Package} rows={data.byProduct} />
            <DimTable title="By price list" icon={Tag} rows={data.byPriceList} />
            <DimTable title="By category" icon={Package} rows={data.byCategory} />
            <DimTable title="By outlet" icon={Building2} rows={data.byOutlet} />
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, tone, wide }: { icon: React.ElementType; label: string; value: string; tone?: 'red' | 'amber' | 'green'; wide?: boolean }) {
  const c = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : tone === 'green' ? 'text-green-600' : 'text-gray-900'
  return <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-3 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}><div className="text-[11px] text-gray-500 flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {label}</div><div className={`text-lg font-bold truncate ${c}`}>{value}</div></div>
}

function DimTable({ title, icon: Icon, rows }: { title: string; icon: React.ElementType; rows: Bucket[] }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2 mb-3"><Icon className="w-4 h-4 text-indigo-600" /> {title}</h3>
      {rows.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No data.</p> : (
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide sticky top-0"><tr><th className="px-3 py-2 text-left font-semibold">Name</th><th className="px-3 py-2 text-right font-semibold">Qty</th><th className="px-3 py-2 text-right font-semibold">Revenue</th><th className="px-3 py-2 text-right font-semibold">Margin</th><th className="px-3 py-2 text-right font-semibold">Var.</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.slice(0, 25).map((r) => (
                <tr key={r.key} className="hover:bg-gray-50">
                  <td className="px-3 py-1.5 font-medium text-gray-800">{r.name}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600">{r.qty.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-gray-900">{formatCurrency(r.revenue)}</td>
                  <td className={`px-3 py-1.5 text-right font-medium ${r.margin < 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(r.margin)} <span className="text-[10px] text-gray-400">{r.marginPct}%</span></td>
                  <td className={`px-3 py-1.5 text-right ${r.variance < 0 ? 'text-red-500' : r.variance > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{r.variance ? formatCurrency(r.variance) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
