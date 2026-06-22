'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import { StatCard } from '@/components/ui/StatCard'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StatCardsSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { ExportBar } from '@/components/ExportBar'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { format, startOfMonth, endOfMonth } from 'date-fns'

interface Outlet { id: string; name: string }
interface StaffRow {
  staffName: string; outletName: string; systemSales: number; total: number; netCollection: number
}

const FILL = ['#4f46e5', '#16a34a', '#2563eb', '#7c3aed', '#d97706', '#db2777']

export default function MonthEndPage() {
  const { request } = useApi()
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [outletId, setOutletId] = useState('')
  const [outlets, setOutlets] = useState<Outlet[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [staffTotals, setStaffTotals] = useState<any>(null)
  const [staff, setStaff] = useState<StaffRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { request('/api/outlets').then(setOutlets).catch(() => {}) }, [request])

  const load = useCallback(async () => {
    setLoading(true)
    const d = new Date(month + '-01T00:00:00')
    const startDate = format(startOfMonth(d), 'yyyy-MM-dd')
    const endDate = format(endOfMonth(d), 'yyyy-MM-dd')
    try {
      const qs = new URLSearchParams({ type: 'custom', startDate, endDate })
      if (outletId) qs.set('outletId', outletId)
      const sc = new URLSearchParams({ from: startDate, to: endDate, groupBy: 'staff' })
      if (outletId) sc.set('outletId', outletId)
      const [rep, staffRep] = await Promise.all([
        request(`/api/reports?${qs}`),
        request(`/api/reports/daily-cashier?${sc}`).catch(() => ({ rows: [], totals: null })),
      ])
      setData(rep)
      setStaff(staffRep.rows || [])
      setStaffTotals(staffRep.totals || null)
    } finally { setLoading(false) }
  }, [request, month, outletId])

  useEffect(() => { load() }, [load])

  const monthLabel = format(new Date(month + '-01T00:00:00'), 'MMMM yyyy')
  const sum = data?.summary || { totalCollected: 0, totalSigned: 0, totalPaid: 0, totalCancelled: 0 }
  const systemSales = staffTotals?.systemSales || 0
  const recoveryRate = sum.totalSigned > 0 ? Math.round((sum.totalPaid / sum.totalSigned) * 100) : 0

  const byMethod = data ? Object.entries(data.byPaymentMethod || {}).map(([name, amount]) => ({ name, amount: amount as number })).filter((d) => d.amount > 0) : []
  const byType = data ? Object.entries(data.byBillType || {}).map(([name, amount]) => ({ name, amount: amount as number })).filter((d) => d.amount > 0) : []
  const topStaff = [...staff].sort((a, b) => b.netCollection - a.netCollection).slice(0, 10)

  const exportRows = staff.map((s) => ({
    Staff: s.staffName, Outlet: s.outletName, 'System Sales': s.systemSales, Collected: s.total, 'Net Collection': s.netCollection,
  }))

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Month-End Summary</h1>
            <p className="text-gray-500 text-sm">Consolidated month view for {monthLabel}</p>
          </div>
          <div className="flex items-end gap-2 flex-wrap">
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              <option value="">All Outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <ExportBar rows={exportRows} filename={`month-end-${month}`} title={`Month-End ${monthLabel}`} />
          </div>
        </div>

        {loading ? (
          <>
            <StatCardsSkeleton count={4} />
            <Skeleton className="h-64 rounded-2xl" />
          </>
        ) : (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <StatCard icon="💰" label="Total Collected" value={formatCurrency(sum.totalCollected)} sub="Cash + bank + M-PESA"
                color="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white" />
              <StatCard icon="🧾" label="System Sales" value={formatCurrency(systemSales)} sub="Per POS" />
              <StatCard icon="📋" label="Credit Issued" value={formatCurrency(sum.totalSigned)} sub="Signed bills" />
              <StatCard icon="✅" label="Debt Recovered" value={formatCurrency(sum.totalPaid)} sub={`${recoveryRate}% of credit issued`}
                color="bg-gradient-to-br from-green-500 to-green-600 text-white" />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader title="Collections by method" />
                {byMethod.length === 0 ? <EmptyState title="No collections this month" /> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={byMethod} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                      <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                        {byMethod.map((_, i) => <Cell key={i} fill={FILL[i % FILL.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
              <Card>
                <CardHeader title="Credit issued by type" />
                {byType.length === 0 ? <EmptyState title="No credit issued this month" /> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={byType} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                      <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                      <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} fontSize={11} tickLine={false} axisLine={false} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                        {byType.map((_, i) => <Cell key={i} fill={FILL[i % FILL.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </Card>
            </div>

            {/* Per-staff */}
            <Card className="p-0 overflow-hidden">
              <div className="p-5 border-b border-gray-100"><h3 className="font-semibold text-gray-800">Performance by staff</h3></div>
              {staff.length === 0 ? (
                <EmptyState icon="🧑‍💼" title="No staff activity this month" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left text-gray-600">
                        <th className="px-4 py-3 font-semibold">Staff</th>
                        <th className="px-4 py-3 font-semibold">Outlet</th>
                        <th className="px-4 py-3 font-semibold text-right">System Sales</th>
                        <th className="px-4 py-3 font-semibold text-right">Collected</th>
                        <th className="px-4 py-3 font-semibold text-right">Net Collection</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {topStaff.map((s, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-800">{s.staffName || '—'}</td>
                          <td className="px-4 py-3 text-gray-500">{s.outletName}</td>
                          <td className="px-4 py-3 text-right text-gray-600">{formatCurrency(s.systemSales)}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{formatCurrency(s.total)}</td>
                          <td className="px-4 py-3 text-right font-bold text-indigo-700">{formatCurrency(s.netCollection)}</td>
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
