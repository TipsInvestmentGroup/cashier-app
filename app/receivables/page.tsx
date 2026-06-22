'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, FINANCE_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { formatCurrency, formatDate, BILL_TYPE_COLORS, BILL_TYPE_LABELS } from '@/lib/utils'
import { ExportBar } from '@/components/ExportBar'
import { PaymentStoryModal } from '@/components/PaymentStoryModal'

interface Receivable {
  id: string; date: string; voucherNumber: string; billType: string; personName: string
  amount: number; balance: number; totalPaid: number; daysOutstanding: number
  isOverdue: boolean; aging: string; dueDate?: string; outlet: { name: string }; description?: string; seq?: number
}
interface Summary { total: number; count: number; overdue: number; byType: Record<string, number> }
interface CreditAccount {
  personName: string; billType: string; creditLimit: number; spent: number
  balance: number; overLimit: number; exceeded: boolean; billCount: number
}

const AGING_COLORS: Record<string, string> = {
  '0-30': 'bg-green-100 text-green-700',
  '31-60': 'bg-yellow-100 text-yellow-700',
  '61-90': 'bg-orange-100 text-orange-700',
  '90+': 'bg-red-100 text-red-700',
}

export default function ReceivablesPage() {
  const { request } = useApi()
  const [receivables, setReceivables] = useState<Receivable[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [creditAccounts, setCreditAccounts] = useState<CreditAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState('')
  const [filterAging, setFilterAging] = useState('')
  const [filterOutlet, setFilterOutlet] = useState('')
  const [filterOverdue, setFilterOverdue] = useState(false)
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])
  const [search, setSearch] = useState('')
  const [storyBillId, setStoryBillId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterType) params.set('type', filterType)
    const [data, payroll, outs] = await Promise.all([
      request(`/api/receivables?${params}`),
      request('/api/payroll-deductions'),
      request('/api/outlets'),
    ])
    setReceivables(data.receivables)
    setSummary(data.summary)
    setCreditAccounts(payroll.creditAccounts || [])
    setOutlets(outs || [])
    setLoading(false)
  }, [request, filterType])

  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const filtered = receivables.filter((r) => {
    if (filterAging && r.aging !== filterAging) return false
    if (filterOverdue && !r.isOverdue) return false
    if (filterOutlet && r.outlet.name !== filterOutlet) return false
    if (q && !(`${r.personName} ${r.voucherNumber}`.toLowerCase().includes(q))) return false
    return true
  })

  const types = ['ADMIN', 'DIRECTOR', 'CUSTOMER', 'STAFF_LOSS', 'TIPS', 'DJ']

  const exportRows = filtered.map((r) => ({
    Date: formatDate(r.date),
    '#': r.seq ?? '',
    Type: BILL_TYPE_LABELS[r.billType] || r.billType,
    Person: r.personName,
    Original: r.amount,
    Paid: r.totalPaid,
    Balance: r.balance,
    Days: r.daysOutstanding,
    Aging: r.aging,
    Outlet: r.outlet.name,
  }))

  return (
    <AppShell>
      <SectionTabs tabs={FINANCE_TABS} />
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Receivables</h1>
          <p className="text-gray-500 text-sm">Track outstanding debts and credit balances</p>
        </div>

        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-red-500 to-red-600 text-white rounded-2xl p-5 shadow-sm">
              <p className="text-sm opacity-80">Total Outstanding</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(summary.total)}</p>
              <p className="text-xs opacity-70 mt-1">{summary.count} bills</p>
            </div>
            <div className="bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-2xl p-5 shadow-sm">
              <p className="text-sm opacity-80">Overdue</p>
              <p className="text-2xl font-bold mt-1">{formatCurrency(summary.overdue)}</p>
              <p className="text-xs opacity-70 mt-1">Past due date</p>
            </div>
            {types.map((t) => (
              summary.byType[t] ? (
                <div key={t} className="bg-white rounded-2xl border-2 border-gray-100 p-5 shadow-sm">
                  <p className="text-xs font-semibold text-gray-500 mb-1">
                    <span className={`inline-block px-2 py-0.5 rounded-lg ${BILL_TYPE_COLORS[t]} text-xs`}>{BILL_TYPE_LABELS[t]}</span>
                  </p>
                  <p className="text-xl font-bold text-gray-800">{formatCurrency(summary.byType[t])}</p>
                </div>
              ) : null
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receivables by name or voucher…"
            className="w-full pl-11 pr-10 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg">✕</button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setFilterType('')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${!filterType ? 'bg-indigo-600 text-white' : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300'}`}>
            All Types
          </button>
          {types.map((t) => (
            <button key={t} onClick={() => setFilterType(filterType === t ? '' : t)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${filterType === t ? 'bg-indigo-600 text-white' : `bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300`}`}>
              {BILL_TYPE_LABELS[t]}
            </button>
          ))}
          <div className="w-px bg-gray-200 mx-1" />
          {['0-30', '31-60', '61-90', '90+'].map((a) => (
            <button key={a} onClick={() => setFilterAging(filterAging === a ? '' : a)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${filterAging === a ? AGING_COLORS[a].replace('bg-', 'bg-').replace('text-', 'border-2 border-') + ' bg-opacity-80' : 'bg-white border-2 border-gray-200 text-gray-700'}`}>
              {a} days
            </button>
          ))}
          <div className="w-px bg-gray-200 mx-1" />
          <button onClick={() => setFilterOverdue(!filterOverdue)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${filterOverdue ? 'bg-red-500 text-white' : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300'}`}>
            🔴 Overdue
          </button>
          {outlets.length > 0 && (
            <select value={filterOutlet} onChange={(e) => setFilterOutlet(e.target.value)}
              className="px-4 py-2 rounded-xl text-sm font-medium border-2 border-gray-200 text-gray-700 bg-white focus:border-indigo-500 focus:outline-none">
              <option value="">🏢 All Outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
            </select>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="font-semibold text-gray-800">{filtered.length} Receivables</h2>
              <span className="text-sm text-gray-500">
                Balance: <strong className="text-red-600">{formatCurrency(filtered.reduce((s, r) => s + r.balance, 0))}</strong>
              </span>
            </div>
            <ExportBar rows={exportRows} filename="receivables" title="Receivables Report" />
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Date / Ref</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Person</th>
                    <th className="px-4 py-3 font-semibold">Original</th>
                    <th className="px-4 py-3 font-semibold">Paid</th>
                    <th className="px-4 py-3 font-semibold">Balance</th>
                    <th className="px-4 py-3 font-semibold">Days</th>
                    <th className="px-4 py-3 font-semibold">Aging</th>
                    <th className="px-4 py-3 font-semibold">Outlet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((r) => (
                    <tr key={r.id} onClick={() => setStoryBillId(r.id)} title="Click for the full payment story"
                      className={`cursor-pointer hover:bg-indigo-50/60 ${r.isOverdue ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">{formatDate(r.date)} · <span className="font-semibold">#{r.seq ?? '—'}</span></td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${BILL_TYPE_COLORS[r.billType]}`}>
                          {BILL_TYPE_LABELS[r.billType]}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {r.personName}
                        {r.isOverdue && <span className="ml-1 text-red-500 text-xs">⚠️ Overdue</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatCurrency(r.amount)}</td>
                      <td className="px-4 py-3 text-green-600">{r.totalPaid > 0 ? formatCurrency(r.totalPaid) : '-'}</td>
                      <td className="px-4 py-3 font-bold text-red-600">{formatCurrency(r.balance)}</td>
                      <td className="px-4 py-3 text-gray-500">{r.daysOutstanding}d</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${AGING_COLORS[r.aging]}`}>{r.aging}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{r.outlet.name}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-12 text-gray-400">
                      {filterType || filterAging ? 'No receivables match your filters' : 'No outstanding receivables 🎉'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Credit Limits — Admins & Directors (moved to bottom) */}
        {(() => {
          const showFor = filterType === '' || filterType === 'ADMIN' || filterType === 'DIRECTOR'
          const accts = creditAccounts.filter((a) => !filterType || a.billType === filterType)
          if (!showFor || accts.length === 0) return null
          const exceededCount = accts.filter((a) => a.exceeded).length
          return (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-semibold text-gray-800">💳 Credit Limits — Admins &amp; Directors</h2>
                {exceededCount > 0 && (
                  <span className="px-3 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700">
                    {exceededCount} EXCEEDED LIMIT
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 font-semibold">Person</th>
                      <th className="px-4 py-3 font-semibold">Type</th>
                      <th className="px-4 py-3 font-semibold">Credit Limit</th>
                      <th className="px-4 py-3 font-semibold">Spent (Owed)</th>
                      <th className="px-4 py-3 font-semibold">Balance</th>
                      <th className="px-4 py-3 font-semibold">Over Limit</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {accts.map((a) => (
                      <tr key={`${a.personName}-${a.billType}`} className={`hover:bg-gray-50 ${a.exceeded ? 'bg-red-50/50' : ''}`}>
                        <td className="px-4 py-3 font-medium text-gray-800">{a.personName}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${BILL_TYPE_COLORS[a.billType]}`}>
                            {BILL_TYPE_LABELS[a.billType]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{formatCurrency(a.creditLimit)}</td>
                        <td className="px-4 py-3 font-semibold text-gray-800">{formatCurrency(a.spent)}</td>
                        <td className={`px-4 py-3 font-medium ${a.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          {a.balance > 0 ? '+' : ''}{formatCurrency(a.balance)}
                        </td>
                        <td className="px-4 py-3 font-bold text-red-600">{a.overLimit > 0 ? formatCurrency(a.overLimit) : '-'}</td>
                        <td className="px-4 py-3">
                          {a.exceeded ? (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-red-100 text-red-700">⚠️ EXCEEDED LIMIT</span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-100 text-green-700">Within Limit</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-3 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
                <strong>Balance</strong> = Amount Spent − Credit Limit. When positive, the over-limit amount is recovered via the{' '}
                <a href="/payroll" className="text-indigo-600 font-medium hover:underline">Payroll Deduction Report</a>.
              </div>
            </div>
          )
        })()}
      </div>

      <PaymentStoryModal billId={storyBillId} request={request} onClose={() => setStoryBillId(null)} />
    </AppShell>
  )
}
