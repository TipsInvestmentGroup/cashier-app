import { Wallet, Calendar, AlertTriangle } from 'lucide-react'
import type { WidgetDef, DrillWidgetDef } from '@/components/widgets/types'
import { formatCurrency } from '@/lib/utils'
import type { DashboardData } from './page'

// The original <StatCard> block these widgets replaced (Phase 3) had no role
// check at all — every role that can reach /dashboard saw it unconditionally.
// Every known Role enum value is listed here (not just SectionTabs' nav-gate
// roles) so that invariant holds regardless of how a user reached the page.
const ALL_DASHBOARD_ROLES = ['CASHIER', 'WAITER', 'ACCOUNTANT', 'MANAGER', 'DIRECTOR', 'ADMIN']

// Oversight roles only — Manager/HR/Finance/Executive decision-support
// widgets (see Phase 4 of the BI layer plan). There's no HR role in this
// app's Role enum, so HR-facing content (staff coaching/recognition) is
// gated to the same oversight roles as everyone else in this group.
const OVERSIGHT_ROLES = ['MANAGER', 'ACCOUNTANT', 'DIRECTOR', 'ADMIN']

export const DASHBOARD_STAT_WIDGETS: WidgetDef<DashboardData>[] = [
  {
    key: 'today-collections', type: 'stat', roles: ALL_DASHBOARD_ROLES,
    icon: Wallet, tone: 'indigo', label: "Today's Collections", href: '/collections',
    getValue: (d) => d.today.total, getSub: () => 'Cash + Bank + M-PESA', getInsight: (d) => d.insights?.today,
  },
  {
    // Progressive-disclosure drill-down (Phase 5): click to see the week's
    // daily rows, click a day for hourly/top-staff/payment detail — see
    // components/widgets/TrendWidget.tsx.
    key: 'this-week', type: 'trend', roles: ALL_DASHBOARD_ROLES,
    label: 'This Week',
    getTotal: (d) => d.week.total,
    getInsight: (d) => d.insights?.week,
    getSeries: (d) => d.weekDailyTrend,
    dayDetailUrl: (day) => `/api/dashboard/day-detail?date=${day.date.slice(0, 10)}`,
  },
  {
    key: 'this-month', type: 'stat', roles: ALL_DASHBOARD_ROLES,
    icon: Calendar, tone: 'blue', label: 'This Month', href: '/reports',
    getValue: (d) => d.month.total, getSub: () => 'Monthly total',
  },
  {
    key: 'outstanding-receivables', type: 'stat', roles: ALL_DASHBOARD_ROLES,
    icon: AlertTriangle, tone: 'amber', label: 'Outstanding Receivables', href: '/receivables',
    getValue: (d) => d.unpaidBills.total, getSub: (d) => `${d.unpaidBills.count} unpaid bills`,
  },
]

export const DASHBOARD_ROLE_WIDGETS: DrillWidgetDef<DashboardData>[] = [
  {
    // Manager's "which staff exceeded targets / performed best" and HR's "who
    // performs well / needs coaching / deserves recognition" both read this
    // same trailing-30-day staff ranking — just two framings of one figure.
    key: 'staff-performance', type: 'drilldown', roles: OVERSIGHT_ROLES,
    title: 'Staff Performance (30 days)',
    getTiles: (d) => {
      const rows = d.staffPerformance || []
      const totalLoss = rows.filter((r) => r.dailyLoss > 0).reduce((s, r) => s + r.dailyLoss, 0)
      const totalExcess = rows.filter((r) => r.dailyLoss < 0).reduce((s, r) => s - r.dailyLoss, 0)
      return [
        { label: 'Staff Tracked', value: rows.length, isCount: true },
        { label: 'Total Loss', value: Math.round(totalLoss) },
        { label: 'Total Excess', value: Math.round(totalExcess) },
      ]
    },
    getRecords: (d) => (d.staffPerformance || []).slice(0, 15).map((r) => ({
      id: r.staffName, label: r.staffName, sub: `${r.days} day(s) tracked`,
      amount: Math.round(Math.abs(r.dailyLoss)), status: r.dailyLoss > 0 ? 'LOSS' : r.dailyLoss < 0 ? 'EXCESS' : 'ON TARGET',
    })),
  },
  {
    // "Which approvals delayed operations?"
    key: 'pending-approvals', type: 'drilldown', roles: OVERSIGHT_ROLES,
    title: 'Pending Approvals',
    getTiles: (d) => [{ label: 'Pending Total', value: d.pendingApprovals?.total || 0, isCount: true }],
    getRecords: (d) => (d.pendingApprovals?.byOutlet || []).map((o) => ({
      id: o.outletId, label: o.outletName, amount: o.count, isCount: true,
    })),
  },
  {
    // Finance's "which bank accounts have unreconciled transactions?" —
    // also visible to oversight roles, not just ACCOUNTANT.
    key: 'unreconciled-bank', type: 'drilldown', roles: OVERSIGHT_ROLES,
    title: 'Unreconciled Bank Accounts (This Month)',
    getTiles: (d) => [{ label: 'Unreconciled Count', value: d.unreconciledBank?.total || 0, isCount: true }],
    getRecords: (d) => (d.unreconciledBank?.byOutlet || []).map((o) => ({
      id: o.outletId, label: o.outletName, amount: o.count, isCount: true,
    })),
  },
  {
    // Executive's "which outlet is growing fastest?" / Manager's "which
    // outlet performed best?"
    key: 'outlet-growth', type: 'drilldown', roles: OVERSIGHT_ROLES,
    title: 'Outlet Growth (Week over Week)',
    getTiles: (d) => {
      const rows = d.outletGrowth || []
      const top = rows[0]
      return [{ label: top ? `Fastest Growing — ${top.outletName}` : 'Fastest Growing', value: top ? Math.round(top.growthPct) : 0, isCount: true, suffix: '%' }]
    },
    getRecords: (d) => (d.outletGrowth || []).map((o) => ({
      id: o.outletId, label: o.outletName,
      sub: `${o.direction === 'up' ? '▲' : o.direction === 'down' ? '▼' : '—'} ${Math.abs(Math.round(o.growthPct))}% vs last week (${formatCurrency(o.prevWeek)})`,
      amount: o.thisWeek,
    })),
  },
]
