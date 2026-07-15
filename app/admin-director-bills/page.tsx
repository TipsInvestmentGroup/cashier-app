'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate } from '@/lib/utils'
import { ExportBar } from '@/components/ExportBar'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { Briefcase, AlertTriangle, Wallet } from 'lucide-react'
import { format, subMonths } from 'date-fns'

interface BillLine {
  id: string; date: string; amount: number; dueDate: string | null
  status: string; outletName: string; description: string | null
}
interface Account {
  personId: string | null; personName: string; billType: string
  creditLimit: number; totalSignedBills: number; remainingBalance: number
  amountExceeding: number; payrollPaid: number
  deductionStatus: 'Within Limit' | 'Pending Deduction' | 'Deducted'
  billCount: number; bills: BillLine[]
}
interface Totals { totalSignedBills: number; totalExceeding: number; exceededCount: number; pendingCount: number }

const STATUS_TONE: Record<Account['deductionStatus'], 'green' | 'red' | 'amber'> = {
  'Within Limit': 'green',
  'Pending Deduction': 'red',
  'Deducted': 'amber',
}

export default function AdminDirectorBillsPage() {
  const { request } = useApi()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])
  const [outletId, setOutletId] = useState('')
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'))
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailFor, setDetailFor] = useState<Account | null>(null)

  const monthOptions = [
    { value: 'all', label: 'All Time (Outstanding)' },
    ...Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(new Date(), i)
      return { value: format(d, 'yyyy-MM'), label: format(d, 'MMMM yyyy') }
    }),
  ]
  const isMonthly = month !== 'all'

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (outletId) params.set('outletId', outletId)
    params.set('month', month)
    const [data, outs] = await Promise.all([
      request(`/api/admin-director-bills?${params}`),
      request('/api/outlets'),
    ])
    setAccounts(data.accounts || [])
    setTotals(data.totals || null)
    setOutlets(outs || [])
    setLoading(false)
  }, [request, outletId, month])

  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const filtered = accounts.filter((a) => {
    if (filterType && a.billType !== filterType) return false
    if (q && !a.personName.toLowerCase().includes(q)) return false
    return true
  })

  const exportRows = filtered.map((a) => ({
    Name: a.personName,
    Type: a.billType === 'DIRECTOR' ? 'Director' : 'Admin',
    'Total Signed Bills': a.totalSignedBills,
    'Credit Limit': a.creditLimit,
    'Remaining Balance': a.remainingBalance,
    'Amount Exceeding Limit': a.amountExceeding,
    'Payroll Deduction Status': a.deductionStatus,
  }))

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Briefcase className="w-6 h-6 text-indigo-600" /> Admin & Director Bills
          </h1>
          <p className="text-gray-500 text-sm">Signed bills, credit limits, and payroll-deduction status for Admins &amp; Directors</p>
        </div>

        {totals && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={Wallet} tone="indigo" label="Total Signed Bills" value={formatCurrency(totals.totalSignedBills)} sub={`${accounts.length} accounts`} />
            <StatCard icon={AlertTriangle} tone="red" label="Amount Exceeding Limits" value={formatCurrency(totals.totalExceeding)} sub={`${totals.exceededCount} exceeded`} />
            <StatCard icon={AlertTriangle} tone="amber" label="Pending Payroll Deduction" value={String(totals.pendingCount)} sub="awaiting deduction run" />
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-600">Period:</span>
            <select value={month} onChange={(e) => setMonth(e.target.value)}
              className="px-4 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              {monthOptions.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-600">Outlet:</span>
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
              className="px-4 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
              <option value="">All Outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setFilterType('')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${!filterType ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-gray-200 text-gray-700'}`}>
              All
            </button>
            <button onClick={() => setFilterType(filterType === 'ADMIN' ? '' : 'ADMIN')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${filterType === 'ADMIN' ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-gray-200 text-gray-700'}`}>
              Admins
            </button>
            <button onClick={() => setFilterType(filterType === 'DIRECTOR' ? '' : 'DIRECTOR')}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${filterType === 'DIRECTOR' ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-gray-200 text-gray-700'}`}>
              Directors
            </button>
          </div>
          <span className="text-xs text-gray-500 ml-auto">
            {isMonthly ? 'Monthly consumption vs monthly credit limit' : 'All-time outstanding balances'}
          </span>
        </div>

        {/* Search */}
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-full pl-11 pr-10 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg">✕</button>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-semibold text-gray-800">{filtered.length} Accounts</h2>
            <ExportBar rows={exportRows} filename="admin-director-bills" title="Admin & Director Bills Report" />
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Total Signed Bills</th>
                    <th className="px-4 py-3 font-semibold">Credit Limit</th>
                    <th className="px-4 py-3 font-semibold">Remaining Balance</th>
                    <th className="px-4 py-3 font-semibold">Amount Exceeding</th>
                    <th className="px-4 py-3 font-semibold">Payroll Deduction Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((a) => (
                    <tr key={`${a.personId}-${a.billType}`} onClick={() => setDetailFor(a)}
                      title="Click to view signed bill details"
                      className={`cursor-pointer hover:bg-indigo-50/60 ${a.amountExceeding > 0 ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3 font-medium text-gray-800">{a.personName}</td>
                      <td className="px-4 py-3"><Badge billType={a.billType}>{a.billType === 'DIRECTOR' ? 'Director' : 'Admin'}</Badge></td>
                      <td className="px-4 py-3 text-gray-700">{formatCurrency(a.totalSignedBills)}</td>
                      <td className="px-4 py-3 text-gray-600">{a.creditLimit > 0 ? formatCurrency(a.creditLimit) : '-'}</td>
                      <td className={`px-4 py-3 font-medium ${a.remainingBalance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatCurrency(a.remainingBalance)}
                      </td>
                      <td className="px-4 py-3 font-bold text-red-600">{a.amountExceeding > 0 ? formatCurrency(a.amountExceeding) : '-'}</td>
                      <td className="px-4 py-3"><Badge tone={STATUS_TONE[a.deductionStatus]}>{a.deductionStatus}</Badge></td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7}>
                      {filterType || q
                        ? <EmptyState icon="🔍" title="No accounts match your filters" hint="Try clearing the type or search filters." />
                        : <EmptyState icon="🎉" title="No Admin/Director bills for this period" hint="Everyone is within limits." />}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="text-xs text-gray-500">
          <strong>Remaining Balance</strong> = Credit Limit − Total Signed Bills. When exceeded, the excess is recovered via the{' '}
          <a href="/payroll" className="text-indigo-600 font-medium hover:underline">Payroll Deduction Report</a>.
        </div>
      </div>

      {/* Bill details drawer */}
      {detailFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setDetailFor(null)}>
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white">
              <div>
                <h3 className="font-bold text-gray-900">{detailFor.personName}</h3>
                <p className="text-xs text-gray-500">{detailFor.billCount} signed bill{detailFor.billCount === 1 ? '' : 's'}</p>
              </div>
              <button onClick={() => setDetailFor(null)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
            </div>
            <div className="p-4 space-y-3">
              {detailFor.bills.map((b) => (
                <div key={b.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">{formatDate(b.date)}</span>
                    <span className="font-bold text-gray-900">{formatCurrency(b.amount)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500">{b.outletName}{b.description ? ` · ${b.description}` : ''}</span>
                    <Badge status={b.status}>{b.status}</Badge>
                  </div>
                  {b.dueDate && <p className="text-xs text-gray-400 mt-1">Due {formatDate(b.dueDate)}</p>}
                </div>
              ))}
              {detailFor.bills.length === 0 && <p className="text-sm text-gray-400 text-center py-6">No bills in this period.</p>}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
