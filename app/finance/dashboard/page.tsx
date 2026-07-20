'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { Card, CardHeader } from '@/components/ui/Card'
import { StatCard } from '@/components/ui/StatCard'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Wallet, TrendingDown, TrendingUp, Gauge } from 'lucide-react'

interface Dashboard {
  cashPosition: number; outstandingPayables: number; outstandingReceivables: number
  budgetUtilization: number | null; liquidityRatio: number | null; workingCapital: number
  revenueTrend: { month: string; amount: number }[]; expenseTrend: { month: string; amount: number }[]
}

export default function FinanceDashboardPage() {
  const { request } = useApi()
  const [data, setData] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await request('/api/finance/dashboard')) } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const trendData = data ? data.revenueTrend.map((r, i) => ({ month: r.month, Revenue: r.amount, Expense: data.expenseTrend[i]?.amount || 0 })) : []

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Finance Dashboard</h1>
          <p className="text-gray-500 text-sm">Live financial health summary</p>
        </div>

        {loading || !data ? <div className="py-10 text-center text-gray-400">Loading…</div> : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <StatCard icon={Wallet} tone="green" label="Cash Position" value={formatCurrency(data.cashPosition)} sub="All bank/cash/mobile accounts" />
              <StatCard icon={TrendingDown} tone="red" label="Outstanding Payables" value={formatCurrency(data.outstandingPayables)} href="/finance/payables" />
              <StatCard icon={TrendingUp} tone="amber" label="Outstanding Receivables" value={formatCurrency(data.outstandingReceivables)} href="/receivables" />
              <StatCard icon={Gauge} tone="indigo" label="Budget Utilization" value={data.budgetUtilization !== null ? `${data.budgetUtilization}%` : '—'} href="/finance/budgets" sub={data.budgetUtilization === null ? 'No budgets set' : undefined} />
              <StatCard icon={Gauge} tone="blue" label="Liquidity Ratio" value={data.liquidityRatio !== null ? data.liquidityRatio.toFixed(2) : '—'} sub="(Cash + Receivables) / Payables" />
              <StatCard icon={Wallet} tone="purple" label="Working Capital" value={formatCurrency(data.workingCapital)} sub="(Cash + Receivables) − Payables" />
            </div>

            <Card>
              <CardHeader title="Revenue vs Expense — last 6 months" />
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={trendData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => formatCurrency(Number(v))} cursor={{ fill: '#f8fafc' }} />
                  <Legend />
                  <Bar dataKey="Revenue" fill="#16a34a" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Expense" fill="#dc2626" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}
