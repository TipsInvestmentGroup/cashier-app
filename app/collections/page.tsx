'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDateTime } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from 'date-fns'

type RangeKey = 'today' | 'week' | 'month' | 'custom'
const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'custom', label: 'Custom' },
]

interface Collection {
  id: string; date: string; cash: number; crdb: number; stanbic: number; mpesa: number; total: number
  notes: string; outlet: { name: string }; cashier: { name: string }
}
interface Outlet { id: string; name: string }

export default function CollectionsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [collections, setCollections] = useState<Collection[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [range, setRange] = useState<RangeKey>('today')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))

  const [form, setForm] = useState({
    cash: '', crdb: '', stanbic: '', mpesa: '', notes: '',
    outletId: user?.outlet?.id || '', date: format(new Date(), 'yyyy-MM-dd'),
  })

  const total = (Number(form.cash) || 0) + (Number(form.crdb) || 0) +
    (Number(form.stanbic) || 0) + (Number(form.mpesa) || 0)

  const load = useCallback(async () => {
    setLoading(true)
    const [cols, outs] = await Promise.all([
      request('/api/collections'),
      request('/api/outlets'),
    ])
    setCollections(cols)
    setOutlets(outs)
    if (outs.length && !form.outletId) setForm((f) => ({ ...f, outletId: outs[0].id }))
    setLoading(false)
  }, [request])

  useEffect(() => { load() }, [load])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (total === 0) return toast.error('Enter at least one amount')
    setSubmitting(true)
    try {
      await request('/api/collections', {
        method: 'POST',
        body: JSON.stringify({ ...form, cash: Number(form.cash) || 0, crdb: Number(form.crdb) || 0, stanbic: Number(form.stanbic) || 0, mpesa: Number(form.mpesa) || 0 }),
      })
      toast.success('Collection saved!')
      setForm({ cash: '', crdb: '', stanbic: '', mpesa: '', notes: '', outletId: form.outletId, date: format(new Date(), 'yyyy-MM-dd') })
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving')
    } finally {
      setSubmitting(false)
    }
  }

  const canAdd = ['CASHIER', 'ACCOUNTANT', 'ADMIN'].includes(user?.role || '')

  // Compute active date interval from the selected range
  const getInterval = (): { start: Date; end: Date } => {
    const now = new Date()
    switch (range) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) }
      case 'week':
        return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
      case 'month':
        return { start: startOfMonth(now), end: endOfMonth(now) }
      case 'custom':
        return { start: startOfDay(parseISO(customFrom)), end: endOfDay(parseISO(customTo)) }
    }
  }
  const interval = getInterval()
  const filtered = collections.filter((c) => {
    try {
      return isWithinInterval(parseISO(c.date), interval)
    } catch {
      return false
    }
  })

  // Totals across the filtered records
  const totals = filtered.reduce(
    (acc, c) => ({
      cash: acc.cash + c.cash,
      crdb: acc.crdb + c.crdb,
      stanbic: acc.stanbic + c.stanbic,
      mpesa: acc.mpesa + c.mpesa,
      total: acc.total + c.total,
    }),
    { cash: 0, crdb: 0, stanbic: 0, mpesa: 0, total: 0 }
  )

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Daily Collections</h1>
            <p className="text-gray-500 text-sm">Record cash, bank & M-PESA collections</p>
          </div>
          {canAdd && (
            <button onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
              <span className="text-lg">+</span> New Collection
            </button>
          )}
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-5">Record Daily Collection</h2>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet</label>
                  <select value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none">
                    {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'cash', label: '💵 Cash', placeholder: '0' },
                  { key: 'crdb', label: '🏦 CRDB Bank', placeholder: '0' },
                  { key: 'stanbic', label: '🏛️ Stanbic', placeholder: '0' },
                  { key: 'mpesa', label: '📱 M-PESA', placeholder: '0' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
                    <input type="number" min="0" placeholder={placeholder}
                      value={form[key as keyof typeof form]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-medium" />
                  </div>
                ))}
              </div>

              {/* Total */}
              <div className="bg-indigo-50 rounded-xl p-4 flex items-center justify-between">
                <span className="font-semibold text-indigo-800">Total Collection</span>
                <span className="text-2xl font-bold text-indigo-700">{formatCurrency(total)}</span>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes (Optional)</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                  rows={2} placeholder="Any notes..." />
              </div>

              <div className="flex gap-3">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                  {submitting ? 'Saving...' : 'Save Collection'}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-6 py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Date Range Filter */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-600 mr-1">Filter:</span>
            {RANGE_OPTIONS.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition ${range === r.key ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                {r.label}
              </button>
            ))}
            {range === 'custom' && (
              <div className="flex items-center gap-2 ml-1">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
                <span className="text-gray-400 text-sm">to</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
              </div>
            )}
          </div>
        </div>

        {/* Totals Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow lg:col-span-1 col-span-2">
            <p className="text-indigo-100 text-xs font-medium">Total Collection</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(totals.total)}</p>
            <p className="text-indigo-200 text-xs mt-1">{filtered.length} record{filtered.length !== 1 ? 's' : ''}</p>
          </div>
          {[
            { label: '💵 Cash', value: totals.cash, color: 'text-green-700' },
            { label: '🏦 CRDB', value: totals.crdb, color: 'text-blue-700' },
            { label: '🏛️ Stanbic', value: totals.stanbic, color: 'text-purple-700' },
            { label: '📱 M-PESA', value: totals.mpesa, color: 'text-yellow-700' },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <p className="text-gray-500 text-xs font-medium">{s.label}</p>
              <p className={`text-lg font-bold mt-1 ${s.color}`}>{formatCurrency(s.value)}</p>
            </div>
          ))}
        </div>

        {/* List */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Collection Records</h2>
            <span className="text-sm text-gray-500">
              {RANGE_OPTIONS.find((r) => r.key === range)?.label} · Total <strong className="text-gray-800">{formatCurrency(totals.total)}</strong>
            </span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-5 py-3 font-semibold">Date</th>
                    <th className="px-5 py-3 font-semibold">Outlet</th>
                    <th className="px-5 py-3 font-semibold">Cash</th>
                    <th className="px-5 py-3 font-semibold">CRDB</th>
                    <th className="px-5 py-3 font-semibold">Stanbic</th>
                    <th className="px-5 py-3 font-semibold">M-PESA</th>
                    <th className="px-5 py-3 font-semibold">Total</th>
                    <th className="px-5 py-3 font-semibold">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-5 py-4 text-gray-700">{formatDateTime(c.date)}</td>
                      <td className="px-5 py-4 font-medium text-gray-800">{c.outlet.name}</td>
                      <td className="px-5 py-4 text-green-700">{c.cash > 0 ? formatCurrency(c.cash) : '-'}</td>
                      <td className="px-5 py-4 text-blue-700">{c.crdb > 0 ? formatCurrency(c.crdb) : '-'}</td>
                      <td className="px-5 py-4 text-purple-700">{c.stanbic > 0 ? formatCurrency(c.stanbic) : '-'}</td>
                      <td className="px-5 py-4 text-yellow-700">{c.mpesa > 0 ? formatCurrency(c.mpesa) : '-'}</td>
                      <td className="px-5 py-4 font-bold text-gray-900">{formatCurrency(c.total)}</td>
                      <td className="px-5 py-4 text-gray-500">{c.cashier.name}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-400">No collections in this period</td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="font-bold text-gray-900">
                      <td className="px-5 py-4" colSpan={2}>TOTAL ({filtered.length})</td>
                      <td className="px-5 py-4 text-green-700">{formatCurrency(totals.cash)}</td>
                      <td className="px-5 py-4 text-blue-700">{formatCurrency(totals.crdb)}</td>
                      <td className="px-5 py-4 text-purple-700">{formatCurrency(totals.stanbic)}</td>
                      <td className="px-5 py-4 text-yellow-700">{formatCurrency(totals.mpesa)}</td>
                      <td className="px-5 py-4 text-indigo-700 text-base">{formatCurrency(totals.total)}</td>
                      <td className="px-5 py-4"></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
