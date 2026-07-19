'use client'
import { useEffect, useState } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'
import { ExportBar } from '@/components/ExportBar'
import { WidgetGrid } from '@/components/widgets/WidgetGrid'
import { DASHBOARD_STAT_WIDGETS, DASHBOARD_ROLE_WIDGETS } from './widgets'
import { Skeleton, StatCardsSkeleton } from '@/components/ui/Skeleton'
import { Banknote, Landmark, Building2, Smartphone, CalendarDays } from 'lucide-react'
import { generateWarningLetters, type FlaggedItem } from '@/lib/warning-letter-pdf'
import type { StaffTotals } from '@/lib/bi/business-sessions'
import type { PendingApprovalCounts } from '@/lib/bi/pending-approvals'
import type { UnreconciledBankCounts } from '@/lib/bi/bank-recon-status'
import {
  ComposedChart, Area, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import { format } from 'date-fns'

export interface DashboardData {
  today: { total: number; cash: number; crdb: number; stanbic: number; mpesa: number; templateCollections: number }
  week: { total: number }
  month: { total: number }
  byBillType: Record<string, number>
  unpaidBills: { total: number; count: number }
  topDebtors: { personName: string; _sum: { amount: number } }[]
  outletPerformance: { name: string; total: number; todayTotal: number; todaySystem: number; todayLoss: number; outstanding: number }[]
  paymentMethodBreakdown: { paymentMethod: string; _sum: { amountPaid: number } }[]
  recentBills: { id: string; personName: string; amount: number; billType: string; status: string; date: string }[]
  dailyTrend: { date: string; total: number }[]
  insights?: {
    today: { text: string; status: 'good' | 'bad' | 'neutral' } | null
    week: { text: string; status: 'good' | 'bad' | 'neutral' } | null
    trend: 'improving' | 'stable' | 'declining'
  }
  // Role-specific decision-support widgets (Manager/HR/Finance/Executive) — see app/dashboard/widgets.ts
  staffPerformance?: StaffTotals[]
  pendingApprovals?: PendingApprovalCounts
  unreconciledBank?: UnreconciledBankCounts
  outletGrowth?: { outletId: string; outletName: string; thisWeek: number; prevWeek: number; growthPct: number; direction: 'up' | 'down' | 'flat' }[]
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
  const { user } = useAuth()
  // Role → persona, which tailors the dashboard content.
  const role = user?.role || ''
  const persona: 'exec' | 'manager' | 'auditor' | 'cashier' = role === 'ADMIN' || role === 'DIRECTOR' ? 'exec'
    : role === 'MANAGER' ? 'manager' : role === 'ACCOUNTANT' ? 'auditor' : 'cashier'
  const analytics = persona !== 'cashier' // heavy management charts hidden from cashiers
  const personaLabel = { exec: 'Executive overview', manager: 'Manager overview', auditor: 'Audit & compliance', cashier: 'Cashier workspace' }[persona]
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dayReady, setDayReady] = useState<{ cashReconDone: boolean; digitalReconDone: boolean; closed: boolean } | null>(null)
  const [variances, setVariances] = useState<{ outlet: string; kind: string; expected: number; actual: number; variance: number }[]>([])
  const [warnings, setWarnings] = useState<{ staffCount: number; flagged: FlaggedItem[] } | null>(null)
  type Growth = { current: number; previous: number; deltaPct: number; spark: number[] }
  const [growth, setGrowth] = useState<{ weekly: Growth; monthly: Growth } | null>(null)
  interface DiffCard { key: string; label: string; amount?: number; count?: number; href: string }
  const [diffCards, setDiffCards] = useState<DiffCard[]>([])

  useEffect(() => {
    request('/api/dashboard')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
    request('/api/reports/variance-alerts').then((r) => setVariances(r.items || [])).catch(() => {})
    request('/api/targets/warning-letters').then((r) => setWarnings(r)).catch(() => {})
    request('/api/dashboard/growth').then((r) => setGrowth(r)).catch(() => {})
    request('/api/collections/day-status').then((r) => setDayReady(r)).catch(() => {})
    request('/api/dashboard/differences').then((r) => setDiffCards(r?.cards || [])).catch(() => {})
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
            <p className="text-gray-500 text-sm">{personaLabel} · {user?.name}</p>
          </div>
          {analytics && <ExportBar rows={exportRows} filename="dashboard-summary" title="Dashboard Summary" />}
        </div>

        {/* Role-tailored quick actions */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {(persona === 'cashier'
            ? [
              { href: '/collections', icon: '💰', label: 'Collections' },
              { href: '/signed-bills', icon: '📋', label: 'Bills' },
              { href: '/paid-bills', icon: '✅', label: 'Payments' },
              { href: '/petty-cash', icon: '💵', label: 'Petty Cash' },
              { href: '/daily-report', icon: '📄', label: 'Daily Report' },
              { href: '/collections', icon: '🔒', label: 'Close Day' },
            ]
            : persona === 'auditor'
            ? [
              { href: '/audit', icon: '🛡️', label: 'Audit Log' },
              { href: '/reports', icon: '📄', label: 'Reports' },
              { href: '/receivables', icon: '📈', label: 'Receivables' },
              { href: '/excess-loss', icon: '🔻', label: 'Excess & Loss' },
              { href: '/payroll', icon: '🧾', label: 'Payroll' },
              { href: '/month-end', icon: '📅', label: 'Month-End' },
            ]
            : [
              { href: '/outlet-comparison', icon: '🏢', label: 'Outlets' },
              { href: '/targets', icon: '🎯', label: 'Targets' },
              { href: '/staff-scorecard', icon: '🧑‍💼', label: 'Staff' },
              { href: '/receivables', icon: '📈', label: 'Receivables' },
              { href: '/month-end', icon: '📅', label: 'Month-End' },
              { href: '/reports', icon: '📄', label: 'Reports' },
            ]
          ).map((a) => (
            <a key={a.label + a.href} href={a.href} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 text-center hover:shadow-md hover:-translate-y-0.5 transition">
              <div className="text-xl">{a.icon}</div>
              <div className="text-xs font-semibold text-gray-700 mt-1">{a.label}</div>
            </a>
          ))}
        </div>

        {/* Cashier: today's reconciliation readiness + close-day CTA */}
        {persona === 'cashier' && dayReady && (
          <div className={`rounded-2xl border-2 p-4 ${dayReady.closed ? 'bg-gray-50 border-gray-200' : 'bg-indigo-50 border-indigo-200'}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-4 text-sm">
                <span className="font-bold text-gray-800">{dayReady.closed ? '🔒 Today is closed' : '🟢 Today is open'}</span>
                <span className={dayReady.cashReconDone ? 'text-green-700' : 'text-amber-600'}>{dayReady.cashReconDone ? '✓' : '○'} Cash recon</span>
                <span className={dayReady.digitalReconDone ? 'text-green-700' : 'text-amber-600'}>{dayReady.digitalReconDone ? '✓' : '○'} Digital recon</span>
              </div>
              {!dayReady.closed && <a href="/collections" className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700">Close the Day →</a>}
            </div>
          </div>
        )}

        {/* Reconciliation variance alerts (today) */}
        {variances.length > 0 && (
          <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <span className="font-bold text-red-800">⚠️ {variances.length} reconciliation variance{variances.length > 1 ? 's' : ''} today</span>
              <a href="/excess-loss" className="text-xs font-semibold text-red-700 underline">View excess & loss →</a>
            </div>
            <div className="flex flex-wrap gap-2">
              {variances.slice(0, 8).map((v, i) => (
                <span key={i} className="text-xs bg-white border border-red-200 rounded-lg px-2 py-1 text-red-700">
                  {v.outlet} · {v.kind}: <strong>{v.variance > 0 ? '+' : ''}{formatCurrency(v.variance)}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Staff due warning letters this week */}
        {(persona === 'exec' || persona === 'manager') && warnings && warnings.staffCount > 0 && (
          <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
              <span className="font-bold text-amber-800">⚠️ {warnings.staffCount} staff due warning letters this week</span>
              <div className="flex gap-3">
                <button onClick={() => generateWarningLetters(warnings.flagged, 'this week')} className="text-xs font-semibold text-amber-700 underline">Download letters</button>
                <a href="/targets" className="text-xs font-semibold text-amber-700 underline">Open Targets →</a>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {[...new Set(warnings.flagged.map((f) => f.staff))].slice(0, 12).map((s, i) => (
                <span key={i} className="text-xs bg-white border border-amber-200 rounded-lg px-2 py-1 text-amber-700">{s}</span>
              ))}
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <WidgetGrid defs={DASHBOARD_STAT_WIDGETS} data={data} role={role} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" />

        {/* Manager/HR/Finance/Executive decision-support widgets — role-gated, additive */}
        <WidgetGrid defs={DASHBOARD_ROLE_WIDGETS} data={data} role={role} className="grid grid-cols-1 sm:grid-cols-2 gap-4" />

        {/* Collection Difference cards (§15) — each drills into the existing
            Collections/Excess Recon/Signed Bills/Cancellations page, filtered
            to today's date range. */}
        {diffCards.length > 0 && (
          <div>
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-2">Collection Differences (Today)</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
              {diffCards.map((c) => (
                <Link key={c.key} href={c.href}
                  className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3.5 hover:border-indigo-300 hover:shadow-md transition block">
                  <p className="text-xs text-gray-500 font-medium">{c.label}</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">
                    {c.amount !== undefined ? formatCurrency(c.amount) : c.count}
                  </p>
                  {c.count !== undefined && c.amount !== undefined && (
                    <p className="text-[11px] text-gray-400 mt-0.5">{c.count} record(s)</p>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Today breakdown */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Cash', value: data.today.cash, Icon: Banknote, chip: 'bg-green-50 text-green-600' },
            { label: 'CRDB Bank', value: data.today.crdb, Icon: Landmark, chip: 'bg-blue-50 text-blue-600' },
            { label: 'Stanbic', value: data.today.stanbic, Icon: Building2, chip: 'bg-purple-50 text-purple-600' },
            { label: 'M-PESA', value: data.today.mpesa, Icon: Smartphone, chip: 'bg-amber-50 text-amber-600' },
            ...(data.today.templateCollections > 0 ? [{ label: 'Template Sessions', value: data.today.templateCollections, Icon: CalendarDays, chip: 'bg-indigo-50 text-indigo-600' }] : []),
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${item.chip}`}><item.Icon className="w-4 h-4" /></span>
                <span className="text-xs font-semibold text-gray-500">{item.label}</span>
              </div>
              <p className="text-lg font-bold text-gray-900">{formatCurrency(item.value)}</p>
            </div>
          ))}
        </div>

        {/* Growth — collections WoW & MoM */}
        {growth && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <GrowthCard label="Collections · This Week" value={growth.weekly.current} deltaPct={growth.weekly.deltaPct} spark={growth.weekly.spark} compareLabel="vs last week" />
            <GrowthCard label="Collections · This Month" value={growth.monthly.current} deltaPct={growth.monthly.deltaPct} spark={growth.monthly.spark} compareLabel="vs last month" />
          </div>
        )}

        {analytics && (<>
        {/* Outstanding Receivables by Category (incl. Tips & DJ) + by Outlet */}
        <div className="bg-white rounded-2xl shadow-sm p-5 border border-gray-100">
          <h3 className="font-semibold text-gray-800 mb-4">Outstanding Receivables by Category</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { k: 'ADMIN', label: 'Admin' }, { k: 'DIRECTOR', label: 'Director' }, { k: 'CUSTOMER', label: 'Customer' },
              { k: 'TIPS', label: 'Tips' }, { k: 'DJ', label: 'DJ' }, { k: 'STAFF_LOSS', label: 'Staff Loss' },
            ].map((c) => (
              <div key={c.k} className="rounded-xl bg-gray-50 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: BILL_TYPE_COLORS[c.k] || '#9ca3af' }} />
                  <span className="text-xs font-semibold text-gray-500">{c.label}</span>
                </div>
                <p className="text-lg font-bold text-gray-900">{formatCurrency(data.byBillType[c.k] || 0)}</p>
              </div>
            ))}
          </div>
          {data.outletPerformance.length > 0 && (
            <>
              <h4 className="text-sm font-semibold text-gray-500 mt-5 mb-2">By Outlet</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {data.outletPerformance.map((o, i) => (
                  <div key={i} className="rounded-xl bg-gray-50 p-4">
                    <div className="flex items-center gap-2 mb-1"><Building2 className="w-4 h-4 text-gray-400" /><span className="text-xs font-semibold text-gray-500 truncate">{o.name}</span></div>
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(o.outstanding)}</p>
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
        </>)}
      </div>
    </AppShell>
  )
}

function GrowthCard({ label, value, deltaPct, spark, compareLabel }: { label: string; value: number; deltaPct: number; spark: number[]; compareLabel: string }) {
  const up = deltaPct >= 0
  const color = up ? '#16a34a' : '#dc2626'
  const data = spark.map((v, i) => ({ i, v }))
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-500">{label}</p>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${up ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{up ? '▲' : '▼'} {Math.abs(deltaPct)}%</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 mt-2 tracking-tight">{formatCurrency(value)}</p>
      <p className="text-xs text-gray-400">{compareLabel}</p>
      <div className="h-10 mt-1 -mx-1">
        <ResponsiveContainer width="100%" height={40}>
          <ComposedChart data={data} margin={{ top: 2, bottom: 0, left: 0, right: 0 }}>
            <defs>
              <linearGradient id={`g-${label.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <Tooltip formatter={(v) => formatCurrency(Number(v))} labelFormatter={() => ''} cursor={{ stroke: '#e5e7eb' }} />
            <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#g-${label.replace(/\W/g, '')})`} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
