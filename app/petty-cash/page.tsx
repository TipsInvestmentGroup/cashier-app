'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox } from '@/components/SearchBox'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { RangeKey, RANGE_OPTIONS, inRange } from '@/lib/dateRange'
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
  const [range, setRange] = useState<RangeKey>('month')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [form, setForm] = useState({ ...INIT, requestedBy: user?.name || '' })
  const [outlets, setOutlets] = useState<{ id: string; name: string }[]>([])
  // Cash reconciliation modal
  const [reconOpen, setReconOpen] = useState(false)
  const [reconForm, setReconForm] = useState({ date: format(new Date(), 'yyyy-MM-dd'), outletId: '', openingBalance: '', cashDeposited: '', notes: '' })
  const [reconComputed, setReconComputed] = useState<{ cashCollected: number; paidBillsCash: number; cashExpenses: number } | null>(null)
  const [reconBusy, setReconBusy] = useState(false)

  const canApprove = ['ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR'].includes(user?.role || '')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [its, outs] = await Promise.all([request('/api/petty-cash'), request('/api/outlets')])
      setItems(its); setOutlets(outs || [])
    } finally { setLoading(false) }
  }, [request])

  const loadRecon = useCallback(async (date: string, outletId: string) => {
    const params = new URLSearchParams({ date }); if (outletId) params.set('outletId', outletId)
    const res = await request(`/api/cash-recon?${params}`)
    setReconComputed(res.computed)
    setReconForm((f) => ({ ...f, openingBalance: res.existing ? String(res.existing.openingBalance) : f.openingBalance, cashDeposited: res.existing ? String(res.existing.cashDeposited) : f.cashDeposited, notes: res.existing?.notes || f.notes }))
  }, [request])

  const openRecon = () => { setReconForm({ date: format(new Date(), 'yyyy-MM-dd'), outletId: '', openingBalance: '', cashDeposited: '', notes: '' }); setReconComputed(null); setReconOpen(true); loadRecon(format(new Date(), 'yyyy-MM-dd'), '') }

  const saveRecon = async () => {
    setReconBusy(true)
    try {
      await request('/api/cash-recon', { method: 'POST', body: JSON.stringify({ ...reconForm, openingBalance: Number(reconForm.openingBalance) || 0, cashDeposited: Number(reconForm.cashDeposited) || 0 }) })
      toast.success('Cash reconciliation saved!')
      setReconOpen(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving reconciliation')
    } finally { setReconBusy(false) }
  }

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
  const filtered = items.filter((i) => {
    if (!inRange(i.date, range, customFrom, customTo)) return false
    if (q && !`${i.requestedBy} ${i.purpose} ${i.department || ''} ${i.payeeName || ''}`.toLowerCase().includes(q)) return false
    return true
  })
  const total = filtered.reduce((s, i) => s + i.amount, 0)

  const act = async (id: string, action: 'approve' | 'reject') => {
    try {
      await request(`/api/petty-cash/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      toast.success(action === 'approve' ? 'Request approved' : 'Request rejected')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error updating request')
    }
  }

  const exportRows = () => filtered.map((i) => ({
    Date: formatDate(i.date), 'Requested By': i.requestedBy, Department: i.department || '',
    Purpose: i.purpose, Amount: i.amount, 'Payment Method': i.paymentMethod,
    Payee: i.payeeName || '', 'Payee Account': i.payeeAccount || '', Status: i.status, 'Approved By': i.approvedBy || '',
  }))
  const fileBase = `petty-cash-${format(new Date(), 'yyyy-MM-dd')}`

  const exportCSV = () => {
    const rows = exportRows()
    if (!rows.length) return toast.error('No data to export')
    const keys = Object.keys(rows[0])
    const csv = [keys.join(','), ...rows.map((r) => keys.map((k) => `"${(r as Record<string, unknown>)[k] ?? ''}"`).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `${fileBase}.csv`; a.click(); URL.revokeObjectURL(url)
    toast.success('CSV exported!')
  }
  const exportExcel = async () => {
    const rows = exportRows()
    if (!rows.length) return toast.error('No data to export')
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Petty Cash')
    XLSX.writeFile(wb, `${fileBase}.xlsx`)
    toast.success('Excel exported!')
  }
  const exportPDF = async () => {
    const rows = exportRows()
    if (!rows.length) return toast.error('No data to export')
    const { jsPDF } = await import('jspdf')
    const autoTable = (await import('jspdf-autotable')).default
    const keys = Object.keys(rows[0])
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFontSize(14); doc.text('Petty Cash Requests', 14, 16)
    doc.setFontSize(9); doc.text(`Total: ${formatCurrency(total)}`, 14, 22)
    autoTable(doc, { startY: 26, head: [keys], body: rows.map((r) => keys.map((k) => String((r as Record<string, unknown>)[k] ?? ''))), styles: { fontSize: 7 }, headStyles: { fillColor: [79, 70, 229] } })
    doc.save(`${fileBase}.pdf`)
    toast.success('PDF exported!')
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Petty Cash Expenses</h1>
            <p className="text-gray-500 text-sm">Record and track cash requests</p>
          </div>
          <button onClick={openRecon}
            className="px-5 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-700 transition shadow">
            💰 Cash Reconciliation
          </button>
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

            <DateRangeFilter range={range} setRange={setRange} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                <h2 className="font-semibold text-gray-800">Cash Requests <span className="text-gray-400 font-normal text-sm">· {RANGE_OPTIONS.find((r) => r.key === range)?.label}</span></h2>
                <div className="flex gap-2">
                  <button onClick={exportCSV} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg hover:bg-gray-200 transition">📄 CSV</button>
                  <button onClick={exportExcel} className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition">📊 Excel</button>
                  <button onClick={exportPDF} className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition">📕 PDF</button>
                </div>
              </div>
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
                        {canApprove && <th className="px-4 py-3 font-semibold text-right">Action</th>}
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
                            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${i.status === 'APPROVED' ? 'bg-green-100 text-green-700' : i.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'}`}>
                              {i.status === 'APPROVED' ? `✓ ${i.approvedBy || 'Approved'}` : i.status === 'REJECTED' ? `✕ Rejected` : 'Pending'}
                            </span>
                          </td>
                          {canApprove && (
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {i.status === 'PENDING' ? (
                                <>
                                  <button onClick={() => act(i.id, 'approve')} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 mr-1">Approve</button>
                                  <button onClick={() => act(i.id, 'reject')} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100">Reject</button>
                                </>
                              ) : <span className="text-gray-300 text-xs">—</span>}
                            </td>
                          )}
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr><td colSpan={canApprove ? 9 : 8} className="text-center py-12 text-gray-400">No cash requests in this period</td></tr>
                      )}
                    </tbody>
                    {filtered.length > 0 && (
                      <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                        <tr>
                          <td className="px-4 py-3" colSpan={4}>TOTAL ({filtered.length})</td>
                          <td className="px-4 py-3 text-indigo-700">{formatCurrency(total)}</td>
                          <td className="px-4 py-3" colSpan={canApprove ? 4 : 3}></td>
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

      {/* Cash Reconciliation modal */}
      {reconOpen && (() => {
        const c = reconComputed || { cashCollected: 0, paidBillsCash: 0, cashExpenses: 0 }
        const opening = Number(reconForm.openingBalance) || 0
        const deposited = Number(reconForm.cashDeposited) || 0
        const closing = opening + c.cashCollected + c.paidBillsCash - c.cashExpenses - deposited
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setReconOpen(false)}>
            <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between p-4 border-b border-gray-100">
                <h3 className="font-bold text-gray-900">💰 Cash Reconciliation</h3>
                <button onClick={() => setReconOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                    <input type="date" value={reconForm.date} onChange={(e) => { setReconForm({ ...reconForm, date: e.target.value }); loadRecon(e.target.value, reconForm.outletId) }}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet</label>
                    <select value={reconForm.outletId} onChange={(e) => { setReconForm({ ...reconForm, outletId: e.target.value }); loadRecon(reconForm.date, e.target.value) }}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                      <option value="">All Outlets</option>
                      {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    </select>
                  </div>
                </div>

                {/* Computed cash figures */}
                <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-600">💵 Cash collected from staff</span><span className="font-semibold">{formatCurrency(c.cashCollected)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">✅ Paid bills (cash)</span><span className="font-semibold">{formatCurrency(c.paidBillsCash)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-600">🧾 Cash expenses (requests)</span><span className="font-semibold text-red-600">−{formatCurrency(c.cashExpenses)}</span></div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Opening Cash Balance (TZS)</label>
                  <input type="number" value={reconForm.openingBalance} onChange={(e) => setReconForm({ ...reconForm, openingBalance: e.target.value })}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="0" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Cash Deposited to Bank (TZS)</label>
                  <input type="number" value={reconForm.cashDeposited} onChange={(e) => setReconForm({ ...reconForm, cashDeposited: e.target.value })}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" />
                </div>

                <div className="bg-indigo-50 rounded-xl p-3 flex items-center justify-between">
                  <span className="font-semibold text-indigo-800">Closing Cash Balance</span>
                  <span className={`text-xl font-bold ${closing < 0 ? 'text-red-700' : 'text-indigo-700'}`}>{formatCurrency(closing)}</span>
                </div>
                <p className="text-xs text-gray-400">Closing = Opening + Collected + Paid-cash − Expenses − Deposited</p>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                  <textarea value={reconForm.notes} onChange={(e) => setReconForm({ ...reconForm, notes: e.target.value })}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" rows={2} placeholder="Any notes…" />
                </div>

                <button onClick={saveRecon} disabled={reconBusy}
                  className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition disabled:opacity-60">
                  {reconBusy ? 'Saving…' : 'Save Reconciliation'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </AppShell>
  )
}
