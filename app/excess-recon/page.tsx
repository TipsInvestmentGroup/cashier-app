'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, DAILY_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { MoneyInput } from '@/components/MoneyInput'
import { formatCurrency, formatDate } from '@/lib/utils'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns'
import toast from 'react-hot-toast'

type RangeKey = 'today' | 'week' | 'month' | 'all' | 'custom'
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' }, { key: 'all', label: 'All' }, { key: 'custom', label: 'Custom' },
]
type StatusFilter = 'ALL' | 'PENDING' | 'SETTLED'

interface Row {
  id: string; source: 'CASH_RECON' | 'COLLECTION'; date: string; outlet: string; person: string
  excess: number; reason: string; reasonLabel: string; paid: number; balance: number; status: 'PENDING' | 'SETTLED'
}
interface Outlet { id: string; name: string }

const SOURCE_LABEL: Record<Row['source'], string> = { CASH_RECON: 'Cash Recon', COLLECTION: 'Collections' }

export default function ExcessReconPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const isCashier = user?.role === 'CASHIER'

  const [range, setRange] = useState<RangeKey>('month')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [outletId, setOutletId] = useState('')
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [payRow, setPayRow] = useState<Row | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [paying, setPaying] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchAmount, setBatchAmount] = useState('')
  const [batching, setBatching] = useState(false)

  useEffect(() => {
    if (!isCashier) request('/api/outlets').then((o) => setOutlets(o || [])).catch(() => {})
  }, [isCashier, request])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (range !== 'all') {
        const now = new Date()
        const interval = range === 'today' ? { start: startOfDay(now), end: endOfDay(now) }
          : range === 'week' ? { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
          : range === 'month' ? { start: startOfMonth(now), end: endOfMonth(now) }
          : { start: startOfDay(new Date(customFrom)), end: endOfDay(new Date(customTo)) }
        qs.set('startDate', format(interval.start, 'yyyy-MM-dd'))
        qs.set('endDate', format(interval.end, 'yyyy-MM-dd'))
      }
      if (!isCashier && outletId) qs.set('outletId', outletId)
      setRows(await request(`/api/excess-recon?${qs.toString()}`))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load Excess Recon')
    } finally { setLoading(false) }
  }, [request, isCashier, outletId, range, customFrom, customTo])

  useEffect(() => { load() }, [load])

  const rowKey = (r: Row) => `${r.source}-${r.id}`
  const visible = rows.filter((r) => statusFilter === 'ALL' || r.status === statusFilter)
  const totalExcess = visible.reduce((s, r) => s + r.excess, 0)
  const totalPaid = visible.reduce((s, r) => s + r.paid, 0)
  const totalBalance = visible.reduce((s, r) => s + r.balance, 0)

  const openPay = (r: Row) => { setPayRow(r); setPayAmount(String(r.balance)) }
  const closePay = () => { setPayRow(null); setPayAmount('') }

  const toggleSelect = (r: Row) => {
    setSelected((prev) => {
      const next = new Set(prev)
      const key = rowKey(r)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const selectedRows = visible
    .filter((r) => r.status === 'PENDING' && selected.has(rowKey(r)))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const selectedBalance = selectedRows.reduce((s, r) => s + r.balance, 0)

  const openBatch = () => { setBatchOpen(true); setBatchAmount(String(selectedBalance)) }
  const closeBatch = () => { setBatchOpen(false); setBatchAmount('') }

  const submitBatch = async () => {
    const amt = Number(batchAmount) || 0
    if (amt <= 0) return toast.error('Enter a payment amount')
    if (amt > selectedBalance) return toast.error(`Payment cannot exceed the combined balance of ${formatCurrency(selectedBalance)}`)
    setBatching(true)
    try {
      await request('/api/excess-recon/settle-batch', {
        method: 'POST',
        body: JSON.stringify({ items: selectedRows.map((r) => ({ id: r.id, source: r.source })), amount: amt }),
      })
      toast.success(`Payment recorded across ${selectedRows.length} record(s)`)
      setSelected(new Set())
      closeBatch()
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error recording batch payment')
    } finally { setBatching(false) }
  }

  const submitPay = async () => {
    if (!payRow) return
    const amt = Number(payAmount) || 0
    if (amt <= 0) return toast.error('Enter a payment amount')
    if (amt > payRow.balance) return toast.error(`Payment cannot exceed the balance of ${formatCurrency(payRow.balance)}`)
    setPaying(true)
    try {
      await request(`/api/excess-recon/${payRow.id}`, { method: 'POST', body: JSON.stringify({ source: payRow.source, amount: amt }) })
      toast.success('Payment recorded')
      closePay()
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error recording payment')
    } finally { setPaying(false) }
  }

  return (
    <AppShell>
      <SectionTabs tabs={DAILY_TABS} />
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Excess Recon</h1>
          <p className="text-gray-500 text-sm">Excess recorded in Cash Reconciliation and Collections, consolidated with Paid/Balance settlement</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-600 mr-1">Period:</span>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${range === r.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{r.label}</button>
          ))}
          {range === 'custom' && (
            <div className="flex items-center gap-2 ml-1">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
            </div>
          )}
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 ml-1">
            {(['PENDING', 'SETTLED', 'ALL'] as StatusFilter[]).map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${statusFilter === s ? 'bg-white shadow text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}>
                {s === 'ALL' ? 'All' : s === 'PENDING' ? 'Pending' : 'Settled'}
              </button>
            ))}
          </div>
          {!isCashier && (
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="ml-auto px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              <option value="">All Outlets</option>
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-2xl p-4 shadow bg-gradient-to-br from-amber-500 to-amber-600 text-white">
            <p className="text-white/80 text-xs font-medium">Total Excess</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(totalExcess)}</p>
          </div>
          <div className="rounded-2xl p-4 shadow bg-gradient-to-br from-green-600 to-green-700 text-white">
            <p className="text-white/80 text-xs font-medium">Total Paid</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(totalPaid)}</p>
          </div>
          <div className="rounded-2xl p-4 shadow bg-gradient-to-br from-red-500 to-red-600 text-white">
            <p className="text-white/80 text-xs font-medium">Total Balance</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(totalBalance)}</p>
          </div>
        </div>

        {loading && <div className="py-12 text-center text-gray-400">Loading…</div>}

        {!loading && selectedRows.length > 0 && (
          <div className="sticky top-2 z-20 bg-indigo-600 text-white rounded-2xl shadow-lg px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold">{selectedRows.length} selected · Balance {formatCurrency(selectedBalance)}</span>
            <div className="flex items-center gap-2">
              <button onClick={() => setSelected(new Set())} className="text-xs font-semibold text-indigo-100 hover:text-white">Clear</button>
              <button onClick={openBatch} className="px-4 py-2 rounded-xl text-sm font-bold bg-white text-indigo-700 hover:bg-indigo-50">Pay Selected</button>
            </div>
          </div>
        )}

        {!loading && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {visible.length === 0 ? (
              <p className="px-4 py-10 text-center text-gray-400 text-sm">No {statusFilter === 'ALL' ? '' : statusFilter.toLowerCase() + ' '}excess records in this period</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-600">
                      <th className="px-4 py-3 font-semibold w-8"></th>
                      <th className="px-4 py-3 font-semibold">Date</th>
                      <th className="px-4 py-3 font-semibold">Source</th>
                      {!isCashier && <th className="px-4 py-3 font-semibold">Outlet</th>}
                      <th className="px-4 py-3 font-semibold">Person</th>
                      <th className="px-4 py-3 font-semibold">Reason</th>
                      <th className="px-4 py-3 font-semibold text-right">Excess</th>
                      <th className="px-4 py-3 font-semibold text-right">Paid</th>
                      <th className="px-4 py-3 font-semibold text-right">Balance</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {visible.map((r) => (
                      <tr key={rowKey(r)} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          {r.status === 'PENDING' && (
                            <input type="checkbox" checked={selected.has(rowKey(r))} onChange={() => toggleSelect(r)} className="w-4 h-4" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{formatDate(r.date)}</td>
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{SOURCE_LABEL[r.source]}</td>
                        {!isCashier && <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.outlet}</td>}
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.person}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{r.reasonLabel}</td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-800">{formatCurrency(r.excess)}</td>
                        <td className="px-4 py-3 text-right text-green-700">{formatCurrency(r.paid)}</td>
                        <td className="px-4 py-3 text-right font-bold text-red-700">{formatCurrency(r.balance)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${r.status === 'SETTLED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {r.status === 'SETTLED' ? 'Settled' : 'Pending'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.status === 'PENDING' && (
                            <button onClick={() => openPay(r)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-700">
                              Record Payment
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment modal */}
      {payRow && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={closePay}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-bold text-gray-900">Record Excess Payment</h3>
              <p className="text-xs text-gray-500 mt-0.5">{payRow.person} · {payRow.reasonLabel} · {formatDate(payRow.date)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-gray-500">Excess</span><span className="font-semibold">{formatCurrency(payRow.excess)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Already paid</span><span className="font-semibold">{formatCurrency(payRow.paid)}</span></div>
              <div className="flex justify-between border-t border-gray-200 pt-1"><span className="text-gray-600">Balance</span><span className="font-bold text-red-700">{formatCurrency(payRow.balance)}</span></div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Payment Amount (TZS)</label>
              <MoneyInput value={payAmount} onChange={setPayAmount}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" />
              <button type="button" onClick={() => setPayAmount(String(payRow.balance))} className="text-xs text-indigo-600 font-semibold mt-1 hover:underline">
                Pay full balance ({formatCurrency(payRow.balance)})
              </button>
            </div>
            <div className="flex gap-2">
              <button onClick={closePay} className="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50">Cancel</button>
              <button onClick={submitPay} disabled={paying} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-60">
                {paying ? 'Saving…' : 'Save Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batch payment modal */}
      {batchOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" onClick={closeBatch}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-bold text-gray-900">Record Batch Excess Payment</h3>
              <p className="text-xs text-gray-500 mt-0.5">{selectedRows.length} record(s) selected</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1 max-h-40 overflow-y-auto">
              {selectedRows.map((r) => (
                <div key={rowKey(r)} className="flex justify-between"><span className="text-gray-500">{r.person} · {r.reasonLabel} · {formatDate(r.date)}</span><span className="font-semibold">{formatCurrency(r.balance)}</span></div>
              ))}
              <div className="flex justify-between border-t border-gray-200 pt-1"><span className="text-gray-600">Combined balance</span><span className="font-bold text-red-700">{formatCurrency(selectedBalance)}</span></div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Payment Amount (TZS)</label>
              <MoneyInput value={batchAmount} onChange={setBatchAmount}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" />
              <p className="text-xs text-gray-400 mt-1">Allocated across the selected records in order, oldest first — each capped at its own balance.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={closeBatch} className="flex-1 py-2.5 rounded-xl border-2 border-gray-200 text-gray-600 font-semibold hover:bg-gray-50">Cancel</button>
              <button onClick={submitBatch} disabled={batching} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:opacity-60">
                {batching ? 'Saving…' : 'Save Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
