'use client'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { ExportBar } from '@/components/ExportBar'
import { StatCard } from '@/components/ui/StatCard'
import { Skeleton, StatCardsSkeleton } from '@/components/ui/Skeleton'
import {
  ComposedChart, Area, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { format } from 'date-fns'

interface DashboardData {
  today: { total: number; cash: number; crdb: number; stanbic: number; mpesa: number }
  week: { total: number }
  month: { total: number }
  byBillType: Record<string, number>
  unpaidBills: { total: number; count: number }
  topDebtors: { personName: string; _sum: { amount: number } }[]
  outletPerformance: { name: string; total: number; todayTotal: number; todaySystem: number; todayLoss: number; outstanding: number }[]
  paymentMethodBreakdown: { paymentMethod: string; _sum: { amountPaid: number } }[]
  recentBills: { id: string; personName: string; amount: number; billType: string; status: string; date: string }[]
  dailyTrend: { date: string; total: number }[]
}

const BILL_TYPE_COLORS: Record<string, string> = {
  ADMIN: '#3b82f6', DIRECTOR: '#8b5cf6', CUSTOMER: '#10b981',
  TIPS: '#f59e0b', DJ: '#ec4899', STAFF_LOSS: '#ef4444',
}
const STATUS_BG: Record<string, string> = {
  UNPAID: 'bg-red-100 text-red-700', PARTIAL: 'bg-yellow-100 text-yellow-700', PAID: 'bg-green-100 text-green-700',
}

export default function DashboardPage() {
  const { request } = useApi()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    request('/api/dashboard')
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [request])

  if (loading) return (
    <AppShell>
      <SectionTabs tabs={DAILY_TABS} />
      <div className="space-y-6">
        <Skeleton className="h-9 w-48" />
        <StatCardsSkeleton count={4} />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </AppShell>
  )

  if (!data) return <AppShell><div className="text-center text-red-500 mt-10">Failed to load dashboard</div></AppShell>

  // 30-day trend with a 7-day moving average overlay (smooths daily spikes).
  const trendData = data.dailyTrend.map((d, i, arr) => {
    const window = arr.slice(Math.max(0, i - 6), i + 1)
    const ma = window.reduce((s, x) => s + x.total, 0) / window.length
    return { date: format(new Date(d.date), 'dd MMM'), total: d.total, ma: Math.round(ma) }
  })

  const paymentPieData = data.paymentMethodBreakdown.map((p) => ({
    name: p.paymentMethod,
    value: p._sum.amountPaid || 0,
  }))
  const pmTotal = paymentPieData.reduce((s, p) => s + p.value, 0)
  // Brand-consistent channel colors (match the table semantics).
  const PM_COLOR: Record<string, string> = { CASH: '#16a34a', CRDB: '#2563eb', STANBIC: '#7c3aed', MPESA: '#d97706', 'M-PESA': '#d97706' }
  const pmFill = (name: string) => PM_COLOR[(name || '').toUpperCase()] || '#94a3b8'

  const CAT_LABELS: Record<string, string> = { ADMIN: 'Admin', DIRECTOR: 'Director', CUSTOMER: 'Customer', TIPS: 'Tips', DJ: 'DJ', STAFF_LOSS: 'Staff Loss' }
  const exportRows = [
    { Metric: "Today's Collections", Amount: data.today.total },
    { Metric: 'This Week', Amount: data.week.total },
    { Metric: 'This Month', Amount: data.month.total },
    { Metric: 'Outstanding Receivables', Amount: data.unpaidBills.total },
    { Metric: 'Today — Cash', Amount: data.today.cash },
    { Metric: 'Today — CRDB', Amount: data.today.crdb },
    { Metric: 'Today — Stanbic', Amount: data.today.stanbic },
    { Metric: 'Today — M-PESA', Amount: data.today.mpesa },
    ...Object.keys(CAT_LABELS).map((k) => ({ Metric: `Outstanding — ${CAT_LABELS[k]}`, Amount: data.byBillType[k] || 0 })),
    ...data.outletPerformance.map((o) => ({ Metric: `Outlet — ${o.name} (outstanding)`, Amount: o.outstanding })),
  ]

  const todayBreakdown = [
    { name: 'Cash', value: data.today.cash },
    { name: 'CRDB', value: data.today.crdb },
    { name: 'Stanbic', value: data.today.stanbic },
    { name: 'M-PESA', value: data.today.mpesa },
  ].filter((x) => x.value > 0)

  return (
    <AppShell>
      <SectionTabs tabs={DAILY_TABS} />
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-500 text-sm">Real-time overview of sales and receivables</p>
          </div>
          <ExportBar rows={exportRows} filename="dashboard-summary" title="Dashboard Summary" />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard icon="💰" label="Today's Collections" value={formatCurrency(data.today.total)}
            sub="Cash + Bank + M-PESA" href="/collections" color="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white" />
          <StatCard icon="📅" label="This Week" value={formatCurrency(data.week.total)}
            sub="Weekly total" href="/reports" color="bg-gradient-to-br from-purple-500 to-purple-600 text-white" />
          <StatCard icon="🗓️" label="This Month" value={formatCurrency(data.month.total)}
            sub="Monthly total" href="/reports" color="bg-gradient-to-br from-pink-500 to-pink-600 text-white" />
          <StatCard icon="⚠️" label="Outstanding Receivables" value={formatCurrency(data.unpaidBills.total)}
            sub={`${data.unpaidBills.count} unpaid bills`} href="/receivables" color="bg-gradient-to-br from-amber-500 to-orange-500 text-white" />
        </div>

        {/* Today breakdown */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Cash', value: data.today.cash, icon: '💵', bg: 'bg-green-50 border-green-200' },
            { label: 'CRDB Bank', value: data.today.crdb, icon: '🏦', bg: 'bg-blue-50 border-blue-200' },
            { label: 'Stanbic', value: data.today.stanbic, icon: '🏛️', bg: 'bg-purple-50 border-purple-200' },
            { label: 'M-PESA', value: data.today.mpesa, icon: '📱', bg: 'bg-yellow-50 border-yellow-200' },
          ].map((item) => (
            <div key={item.label} className={`rounded-xl border-2 p-4 ${item.bg}`}>
              <div className="flex items-center gap-2 mb-1">
                <span>{item.icon}</span>
                <span className="text-xs font-semibold text-gray-600">{item.label}</span>
              </div>
              <p className="text-lg font-bold text-gray-800">{formatCurrency(item.value)}</p>
            </div>
          ))}
        </div>

        {/* Outstanding Receivables by Category (incl. Tips & DJ) + by Outlet */}
        <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-4">📂 Outstanding Receivables by Category</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { k: 'ADMIN', label: 'Admin' }, { k: 'DIRECTOR', label: 'Director' }, { k: 'CUSTOMER', label: 'Customer' },
              { k: 'TIPS', label: 'Tips' }, { k: 'DJ', label: 'DJ' }, { k: 'STAFF_LOSS', label: 'Staff Loss' },
            ].map((c) => (
              <div key={c.k} className="rounded-xl border-2 p-4" style={{ borderColor: (BILL_TYPE_COLORS[c.k] || '#e5e7eb') + '55' }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BILL_TYPE_COLORS[c.k] || '#9ca3af' }} />
                  <span className="text-xs font-semibold text-gray-600">{c.label}</span>
                </div>
                <p className="text-lg font-bold text-gray-800">{formatCurrency(data.byBillType[c.k] || 0)}</p>
              </div>
            ))}
          </div>
          {data.outletPerformance.length > 0 && (
            <>
              <h4 className="text-sm font-semibold text-gray-500 mt-5 mb-2">By Outlet</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {data.outletPerformance.map((o, i) => (
                  <div key={i} className="rounded-xl border-2 border-gray-100 p-4">
                    <div className="flex items-center gap-2 mb-1"><span>🏢</span><span className="text-xs font-semibold text-gray-600 truncate">{o.name}</span></div>
                    <p className="text-lg font-bold text-gray-800">{formatCurrency(o.outstanding)}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 30-day trend */}
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-4">30-Day Collection Trend</h3>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={trendData}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" name="Daily" dataKey="total" stroke="#6366f1" fill="url(#colorTotal)" strokeWidth={2} />
                <Line type="monotone" name="7-day avg" dataKey="ma" stroke="#0f766e" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Payment Method Pie */}
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-4">Payment Methods (Month)</h3>
            {paymentPieData.length > 0 ? (
              <div className="relative">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={paymentPieData} cx="50%" cy="50%" innerRadius={60} outerRadius={92}
                      dataKey="value" paddingAngle={2} // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      label={({ name, percent }: any) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false} fontSize={11}>
                      {paymentPieData.map((p, i) => <Cell key={i} fill={pmFill(p.name)} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">Total</span>
                  <span className="text-base font-bold text-gray-800">{formatCurrency(pmTotal)}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No data yet</div>
            )}
          </div>
        </div>

        {/* Outlet Performance Widget — today's status per outlet */}
        {data.outletPerformance.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-4">🏢 Outlet Performance — Today</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Outlet</th>
                    <th className="px-4 py-3 font-semibold">System Sales</th>
                    <th className="px-4 py-3 font-semibold">Collected Today</th>
                    <th className="px-4 py-3 font-semibold">Loss Today</th>
                    <th className="px-4 py-3 font-semibold">Outstanding</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.outletPerformance.map((o, i) => {
                    const healthy = o.todayLoss === 0
                    return (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium text-gray-800">{o.name}</td>
                        <td className="px-4 py-3 text-gray-600">{formatCurrency(o.todaySystem)}</td>
                        <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(o.todayTotal)}</td>
                        <td className={`px-4 py-3 font-semibold ${o.todayLoss > 0 ? 'text-red-600' : 'text-green-600'}`}>{o.todayLoss > 0 ? formatCurrency(o.todayLoss) : '—'}</td>
                        <td className="px-4 py-3 text-orange-600">{formatCurrency(o.outstanding)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${healthy ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {healthy ? '🟢 On track' : '🔴 Shortfall'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Outlet Performance & Top Debtors */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-4">Outlet Performance (Month)</h3>
            {data.outletPerformance.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.outletPerformance}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: unknown) => formatCurrency(v as number)} />
                  <Bar dataKey="total" fill="#6366f1" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No outlet data</div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
            <h3 className="font-semibold text-gray-800 mb-4">Top Debtors</h3>
            {data.topDebtors.length > 0 ? (
              <div className="space-y-3">
                {data.topDebtors.map((d, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-sm">
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{d.personName}</p>
                      <div className="h-1.5 bg-gray-100 rounded-full mt-1">
                        <div className="h-1.5 bg-red-400 rounded-full"
                          style={{ width: `${Math.min(100, ((d._sum.amount || 0) / (data.topDebtors[0]._sum.amount || 1)) * 100)}%` }} />
                      </div>
                    </div>
                    <span className="text-sm font-bold text-red-600">{formatCurrency(d._sum.amount || 0)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-gray-400 text-sm">No outstanding debts 🎉</div>
            )}
          </div>
        </div>

        {/* Recent Signed Bills */}
        <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-4">Recent Signed Bills</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="pb-3 font-medium">Person</th>
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Amount</th>
                  <th className="pb-3 font-medium">Status</th>
                  <th className="pb-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {data.recentBills.map((b) => (
                  <tr key={b.id} className="hover:bg-gray-50">
                    <td className="py-3 font-medium text-gray-800">{b.personName}</td>
                    <td className="py-3">
                      <span className="px-2 py-1 rounded-lg text-xs font-medium"
                        style={{ backgroundColor: BILL_TYPE_COLORS[b.billType] + '20', color: BILL_TYPE_COLORS[b.billType] }}>
                        {b.billType}
                      </span>
                    </td>
                    <td className="py-3 font-bold text-gray-800">{formatCurrency(b.amount)}</td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded-lg text-xs font-medium ${STATUS_BG[b.status]}`}>{b.status}</span>
                    </td>
                    <td className="py-3 text-gray-500">{format(new Date(b.date), 'dd MMM')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.recentBills.length === 0 && (
              <p className="text-center text-gray-400 py-8">No signed bills recorded yet</p>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
