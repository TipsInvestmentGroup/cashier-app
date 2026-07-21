'use client'
import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { EmptyState } from '@/components/ui/EmptyState'
import { formatCurrency } from '@/lib/utils'
import { format, startOfMonth } from 'date-fns'
import { TrendingUp, Package, Users, Receipt, AlertTriangle, Trophy, Snail, Building2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, LineChart, Line, Cell } from 'recharts'

interface Named { name: string; qty: number; revenue: number }
interface ProductRow extends Named { key: string; productId: string | null; category: string | null; lines: number }
interface StaffRow { staffName: string; qty: number; revenue: number; products: number }
interface OutletRow { outletId: string; name: string; qty: number; revenue: number }
interface Analytics {
  kpis: { revenue: number; qty: number; lines: number; products: number; staff: number; priceMismatches: number; avgLineValue: number }
  products: ProductRow[]; bestSellers: ProductRow[]; slowSellers: ProductRow[]
  categories: Named[]; staff: StaffRow[]; outlets: OutletRow[]
  trend: { date: string; qty: number; revenue: number }[]
  outletOptions: { id: string; name: string }[]
}

const MGMT = ['ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']
const BAR_COLORS = ['#4f46e5', '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe', '#4338ca', '#6d28d9', '#7c3aed', '#8b5cf6', '#a78bfa']
const compact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}k` : `${n}`

export function SalesAnalytics() {
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
    try {
      const qs = new URLSearchParams({ from, to }); if (outletId) qs.set('outletId', outletId)
      setData(await request(`/api/sales-imports/analytics?${qs.toString()}`))
    } catch { setData(null) } finally { setLoading(false) }
  }, [request, from, to, outletId])
  useEffect(() => { load() }, [load])

  const k = data?.kpis
  const hasData = !!data && data.kpis.lines > 0

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
        </div>
        {canPickOutlet && (
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              <option value="">All outlets</option>
              {(data?.outletOptions || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        <p className="text-[11px] text-gray-400 ml-auto self-center">Built only from approved (imported) sales.</p>
      </div>

      {loading && <p className="text-sm text-indigo-500 animate-pulse">Loading analytics…</p>}

      {!loading && !hasData && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
          <EmptyState icon="📊" title="No imported sales in this range" hint="Approve an import (or widen the date range) to see product, staff and outlet analytics." />
        </div>
      )}

      {!loading && hasData && k && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Kpi icon={TrendingUp} label="Revenue" value={formatCurrency(k.revenue)} wide />
            <Kpi icon={Receipt} label="Items sold" value={k.qty.toLocaleString()} />
            <Kpi icon={Package} label="Products" value={k.products.toLocaleString()} />
            <Kpi icon={Users} label="Staff" value={k.staff.toLocaleString()} />
            <Kpi icon={Receipt} label="Lines" value={k.lines.toLocaleString()} />
            <Kpi icon={AlertTriangle} label="Price mismatches" value={k.priceMismatches.toLocaleString()} tone={k.priceMismatches ? 'amber' : undefined} />
          </div>

          {/* Trend */}
          <Card title="Revenue trend" icon={TrendingUp}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data.trend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(d) => String(d).slice(5)} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => compact(Number(v))} width={44} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} labelClassName="text-xs" />
                <Line type="monotone" dataKey="revenue" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid lg:grid-cols-2 gap-5">
            {/* Top products */}
            <Card title="Top products by revenue" icon={Trophy}>
              <ResponsiveContainer width="100%" height={Math.max(200, Math.min(8, data.bestSellers.length) * 34)}>
                <BarChart data={data.bestSellers.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => compact(Number(v))} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#334155' }} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
                    {data.bestSellers.slice(0, 8).map((_, i) => <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            {/* Category breakdown */}
            <Card title="Sales by category" icon={Package}>
              <ResponsiveContainer width="100%" height={Math.max(200, Math.min(8, data.categories.length) * 34)}>
                <BarChart data={data.categories.slice(0, 8)} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => compact(Number(v))} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#334155' }} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: '#f8fafc' }} />
                  <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
                    {data.categories.slice(0, 8).map((_, i) => <Cell key={i} fill={BAR_COLORS[(i + 3) % BAR_COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Staff leaderboard + outlet performance */}
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="Staff performance" icon={Users}>
              <MiniTable head={['#', 'Staff', 'Items', 'Revenue']} rows={data.staff.slice(0, 15).map((s, i) => [String(i + 1), s.staffName, s.qty.toLocaleString(), formatCurrency(s.revenue)])} rightCols={[2, 3]} />
            </Card>
            {data.outlets.length > 1 ? (
              <Card title="Outlet performance" icon={Building2}>
                <MiniTable head={['Outlet', 'Items', 'Revenue']} rows={data.outlets.map((o) => [o.name, o.qty.toLocaleString(), formatCurrency(o.revenue)])} rightCols={[1, 2]} />
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-5">
                <Card title="Best sellers" icon={Trophy}>
                  <MiniTable head={['Product', 'Qty', 'Revenue']} rows={data.bestSellers.slice(0, 8).map((p) => [p.name, p.qty.toLocaleString(), formatCurrency(p.revenue)])} rightCols={[1, 2]} />
                </Card>
              </div>
            )}
          </div>

          {/* Best / Slow sellers side by side */}
          <div className="grid lg:grid-cols-2 gap-5">
            <Card title="Best sellers" icon={Trophy}>
              <MiniTable head={['Product', 'Category', 'Qty', 'Revenue']} rows={data.bestSellers.map((p) => [p.name, p.category || '—', p.qty.toLocaleString(), formatCurrency(p.revenue)])} rightCols={[2, 3]} />
            </Card>
            <Card title="Slow sellers" icon={Snail}>
              <MiniTable head={['Product', 'Category', 'Qty', 'Revenue']} rows={data.slowSellers.map((p) => [p.name, p.category || '—', p.qty.toLocaleString(), formatCurrency(p.revenue)])} rightCols={[2, 3]} />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, tone, wide }: { icon: React.ElementType; label: string; value: string; tone?: 'amber'; wide?: boolean }) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-gray-100 p-3 ${wide ? 'col-span-2 sm:col-span-1' : ''}`}>
      <div className="text-[11px] text-gray-500 flex items-center gap-1"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className={`text-lg font-bold truncate ${tone === 'amber' ? 'text-amber-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  )
}

function Card({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2 mb-3"><Icon className="w-4 h-4 text-indigo-600" /> {title}</h3>
      {children}
    </div>
  )
}

function MiniTable({ head, rows, rightCols = [] }: { head: string[]; rows: string[][]; rightCols?: number[] }) {
  if (!rows.length) return <p className="text-sm text-gray-400 py-4 text-center">No data.</p>
  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide sticky top-0">
          <tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 font-semibold ${rightCols.includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r, ri) => (
            <tr key={ri} className="hover:bg-gray-50">
              {r.map((c, ci) => <td key={ci} className={`px-3 py-1.5 ${rightCols.includes(ci) ? 'text-right font-semibold text-gray-900' : 'text-gray-700'} ${ci === 0 && !rightCols.includes(0) ? 'font-medium text-gray-800' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
