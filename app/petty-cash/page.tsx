'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox } from '@/components/SearchBox'
import toast from 'react-hot-toast'
import { format } from 'date-fns'

interface PettyCash {
  id: string; date: string; requestedBy: string; department?: string; purpose: string
  amount: number; paymentMethod: string; payeeName?: string; payeeAccount?: string
  approvedBy?: string; status: string
}

const METHODS = [
  { value: 'CASH', label: '💵 Cash' },
  { value: 'CRDB', label: '🏦 CRDB' },
  { value: 'STANBIC', label: '🏛️ Stanbic' },
  { value: 'MPESA', label: '📱 M-PESA' },
]

const INIT = {
  date: format(new Date(), 'yyyy-MM-dd'), requestedBy: '', department: '', purpose: '',
  amount: '', paymentMethod: 'CASH', payeeName: '', payeeAccount: '', approvedBy: '',
}

export default function PettyCashPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [items, setItems] = useState<PettyCash[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({ ...INIT, requestedBy: user?.name || '' })

  const load = useCallback(async () => {
    setLoading(true)
    try { setItems(await request('/api/petty-cash')) } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const canRequest = ['CASHIER', 'ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR'].includes(user?.role || '')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.requestedBy) return toast.error('Requested by is required')
    if (!form.purpose) return toast.error('Purpose is required')
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Amount must be > 0')
    setSubmitting(true)
    try {
      await request('/api/petty-cash', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount) }) })
      toast.success('Cash request submitted!')
      setForm({ ...INIT, requestedBy: user?.name || '' })
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error submitting request')
    } finally {
      setSubmitting(false)
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = items.filter((i) => !q || `${i.requestedBy} ${i.purpose} ${i.department || ''} ${i.payeeName || ''}`.toLowerCase().includes(q))
  const total = filtered.reduce((s, i) => s + i.amount, 0)

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Petty Cash Expenses</h1>
          <p className="text-gray-500 text-sm">Record and track cash requests</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* LEFT: list */}
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow">
                <p className="text-indigo-100 text-xs">Total Requested</p>
                <p className="text-2xl font-bold mt-1">{formatCurrency(total)}</p>
                <p className="text-indigo-200 text-xs mt-1">{filtered.length} requests</p>
              </div>
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
                <p className="text-gray-500 text-xs">⏳ Pending</p>
                <p className="text-lg font-bold mt-1 text-orange-600">{filtered.filter((i) => i.status !== 'APPROVED').length}</p>
              </div>
            </div>

            <SearchBox value={search} onChange={setSearch} placeholder="Search by requester, purpose, department or payee…" />

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100"><h2 className="font-semibold text-gray-800">Cash Requests</h2></div>
              {loading ? (
                <div className="py-16 text-center text-gray-400">Loading…</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr className="text-left text-gray-600">
                        <th className="px-4 py-3 font-semibold">Date</th>
                        <th className="px-4 py-3 font-semibold">Requested By</th>
                        <th className="px-4 py-3 font-semibold">Department</th>
                        <th className="px-4 py-3 font-semibold">Purpose</th>
                        <th className="px-4 py-3 font-semibold">Amount</th>
                        <th className="px-4 py-3 font-semibold">Method</th>
                        <th className="px-4 py-3 font-semibold">Payee</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filtered.map((i) => (
                        <tr key={i.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(i.date)}</td>
                          <td className="px-4 py-3 font-medium text-gray-800">{i.requestedBy}</td>
                          <td className="px-4 py-3 text-gray-500">{i.department || '-'}</td>
                          <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate" title={i.purpose}>{i.purpose}</td>
                          <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(i.amount)}</td>
                          <td className="px-4 py-3 text-gray-500">{i.paymentMethod}</td>
                          <td className="px-4 py-3 text-gray-500">{i.payeeName || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${i.status === 'APPROVED' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                              {i.status === 'APPROVED' ? `✓ ${i.approvedBy || 'Approved'}` : 'Pending'}
                            </span>
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={8} className="text-center py-12 text-gray-400">No cash requests yet</td></tr>
                      )}
                    </tbody>
                    {filtered.length > 0 && (
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                        <tr>
                          <td className="px-4 py-3" colSpan={4}>TOTAL ({filtered.length})</td>
                          <td className="px-4 py-3 text-indigo-700">{formatCurrency(total)}</td>
                          <td className="px-4 py-3" colSpan={3}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Cash Request Form */}
          {canRequest && (
            <div className="lg:col-span-1">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 lg:sticky lg:top-4">
                <h2 className="text-lg font-bold text-gray-800 mb-1">🧾 Cash Request Form</h2>
                <p className="text-xs text-gray-400 mb-4">Fill all required fields</p>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                    <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Requested By *</label>
                    <input type="text" value={form.requestedBy} onChange={(e) => setForm({ ...form, requestedBy: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Full name" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Department</label>
                    <input type="text" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="e.g. Kitchen, Bar, Admin" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Purpose of Request *</label>
                    <textarea value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" rows={2} placeholder="What is the cash for?" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Amount Requested (TZS) *</label>
                    <input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method</label>
                    <div className="grid grid-cols-2 gap-2">
                      {METHODS.map((m) => (
                        <button key={m.value} type="button" onClick={() => setForm({ ...form, paymentMethod: m.value })}
                          className={`py-2 rounded-xl text-sm font-medium transition ${form.paymentMethod === m.value ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Payee Name <span className="text-gray-400 font-normal">(if applicable)</span></label>
                    <input type="text" value={form.payeeName} onChange={(e) => setForm({ ...form, payeeName: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Who receives the money" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Payee Account <span className="text-gray-400 font-normal">(if applicable)</span></label>
                    <input type="text" value={form.payeeAccount} onChange={(e) => setForm({ ...form, payeeAccount: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Account / phone number" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Approved By</label>
                    <input type="text" value={form.approvedBy} onChange={(e) => setForm({ ...form, approvedBy: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Approver name (leave blank if pending)" />
                  </div>
                  <button type="submit" disabled={submitting}
                    className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                    {submitting ? 'Submitting…' : 'Submit Cash Request'}
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
