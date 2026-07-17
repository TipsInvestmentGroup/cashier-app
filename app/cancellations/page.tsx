'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, BILLS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox } from '@/components/SearchBox'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { ExportBar } from '@/components/ExportBar'
import { RangeKey, RANGE_OPTIONS, inRange } from '@/lib/dateRange'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { notifyPendingCountsChanged } from '@/lib/pendingBellEvents'

interface Cancellation {
  id: string; date: string; reason: string; productName: string; sellingPrice: number
  quantity: number; amount: number; status: string; approvedBy: string; staffName: string; outletName: string
}
interface Staff { id: string; name: string; type: string }
interface Product { id: string; name: string; sellingPrice: number; isActive: boolean; categoryId?: string | null }
interface CancelReason { code: string; label: string; isActive: boolean; appliesToAll: boolean; categoryIds: string[]; productIds: string[] }
const INIT = { staffName: '', productId: '', productName: '', sellingPrice: 0, reason: '', quantity: '' }

const STATUS_STYLE: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  PENDING: 'bg-orange-100 text-orange-700',
}

function CancellationsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const [items, setItems] = useState<Cancellation[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<RangeKey>('month')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [statusFilter, setStatusFilter] = useState('')
  const [groupBy, setGroupBy] = useState<'none' | 'staff' | 'product'>('none')
  const [staff, setStaff] = useState<Staff[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [cancelReasons, setCancelReasons] = useState<CancelReason[]>([])
  const reasonsForProduct = (productId: string) => {
    const product = products.find((p) => p.id === productId)
    return cancelReasons
      .filter((r) => r.isActive)
      .filter((r) => r.appliesToAll || !productId || (product && (r.categoryIds.includes(product.categoryId || '') || r.productIds.includes(productId))))
      .map((r) => r.label)
  }
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ ...INIT })
  const [canApprove, setCanApprove] = useState(false)
  const [canCreate, setCanCreate] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, persons, prods, access, reasons] = await Promise.all([
        request('/api/cancellations'), request('/api/persons'), request('/api/products'), request('/api/cancellation-access'),
        request('/api/cancellation-reasons').catch(() => []),
      ])
      setItems(rows || [])
      setStaff((persons || []).filter((p: Staff) => p.type === 'STAFF_LOSS').sort((a: Staff, b: Staff) => a.name.localeCompare(b.name)))
      setProducts((prods || []).filter((p: Product) => p.isActive))
      setCancelReasons(reasons || [])
      setCanApprove(!!access?.canApprove)
      setCanCreate(!!access?.canCreate)
    } finally { setLoading(false) }
  }, [request])

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.productName) return toast.error('Select a product')
    if (!form.quantity || Number(form.quantity) <= 0) return toast.error('Quantity must be > 0')
    setSubmitting(true)
    try {
      await request('/api/cancellations', { method: 'POST', body: JSON.stringify({ ...form, quantity: Number(form.quantity) }) })
      toast.success('Cancellation request filed')
      setForm({ ...INIT }); setShowForm(false); load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not file request')
    } finally { setSubmitting(false) }
  }

  useEffect(() => { load() }, [load])

  // Deep-link from the notification bell: it counts pending requests across
  // all time, but this page defaults to "This Month" — widen the range so
  // the pending items the bell counted are actually visible here.
  useEffect(() => {
    if (searchParams.get('pending') === '1') {
      setRange('custom')
      setCustomFrom('2000-01-01')
      setStatusFilter('PENDING')
    }
  }, [searchParams])

  const act = async (id: string, action: 'approve' | 'reject') => {
    try {
      await request(`/api/cancellations/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      toast.success(action === 'approve' ? 'Cancellation approved' : 'Cancellation rejected')
      load()
      notifyPendingCountsChanged()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Error updating') }
  }

  const q = search.trim().toLowerCase()
  const filtered = items.filter((c) => {
    if (!inRange(c.date, range, customFrom, customTo)) return false
    if (statusFilter && c.status !== statusFilter) return false
    if (q && !`${c.staffName} ${c.productName} ${c.reason}`.toLowerCase().includes(q)) return false
    return true
  })

  // Only APPROVED cancellations count toward the financial total (Pending awaits approval)
  const total = filtered.filter((c) => c.status === 'APPROVED').reduce((s, c) => s + c.amount, 0)
  const pending = filtered.filter((c) => c.status === 'PENDING').length

  // Grouped aggregation
  const grouped = (() => {
    if (groupBy === 'none') return []
    const m = new Map<string, { key: string; count: number; qty: number; amount: number; approved: number; rejected: number; pending: number }>()
    for (const c of filtered) {
      const key = groupBy === 'staff' ? c.staffName : c.productName
      let r = m.get(key)
      if (!r) { r = { key, count: 0, qty: 0, amount: 0, approved: 0, rejected: 0, pending: 0 }; m.set(key, r) }
      r.count++; r.qty += c.quantity; r.amount += c.amount
      if (c.status === 'APPROVED') r.approved++; else if (c.status === 'REJECTED') r.rejected++; else r.pending++
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount)
  })()

  const exportRows = filtered.map((c) => ({
    Date: formatDate(c.date), Staff: c.staffName, Product: c.productName, Reason: c.reason,
    Qty: c.quantity, 'Selling Price': c.sellingPrice, Amount: c.amount, Status: c.status, 'Approved/By': c.approvedBy, Outlet: c.outletName,
  }))

  return (
    <AppShell>
      <SectionTabs tabs={BILLS_TABS} />
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Cancellations</h1>
            <p className="text-gray-500 text-sm">Cancellation report by staff, product and status</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {canCreate && (
              <button onClick={() => setShowForm((s) => !s)}
                className="px-5 py-3 bg-rose-600 text-white rounded-xl font-medium hover:bg-rose-700 transition shadow">
                ➕ Add Cancellation
              </button>
            )}
            <ExportBar rows={exportRows} filename={`cancellations-${format(new Date(), 'yyyy-MM-dd')}`} title="Cancellation Report" />
          </div>
        </div>

        {showForm && canCreate && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-3">🚫 New Cancellation Request</h2>
            <form onSubmit={submitRequest} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Staff</label>
                <select value={form.staffName} onChange={(e) => setForm({ ...form, staffName: e.target.value })}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white text-sm">
                  <option value="">Select staff…</option>
                  {staff.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Product</label>
                <select value={form.productId} onChange={(e) => {
                  const p = products.find((x) => x.id === e.target.value)
                  const nextReasons = reasonsForProduct(e.target.value)
                  const nextReason = nextReasons.includes(form.reason) ? form.reason : (nextReasons[0] || '')
                  setForm({ ...form, productId: e.target.value, productName: p?.name || '', sellingPrice: p?.sellingPrice || 0, reason: nextReason })
                }}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white text-sm">
                  <option value="">Select product…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatCurrency(p.sellingPrice)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Reason</label>
                <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white text-sm">
                  {reasonsForProduct(form.productId).map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Qty <span className="text-gray-400 font-normal">→ {formatCurrency(form.sellingPrice * (Number(form.quantity) || 0))}</span></label>
                <input type="number" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" placeholder="Qty" />
              </div>
              <button type="submit" disabled={submitting}
                className="py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                {submitting ? 'Saving…' : 'File Request'}
              </button>
            </form>
            <p className="text-xs text-gray-400 mt-2">Filed as <strong>Pending</strong> — a manager/accountant approves or rejects it. {products.length === 0 && 'Add products first under Products.'}</p>
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-rose-500 to-rose-600 text-white rounded-2xl p-4 shadow col-span-2 sm:col-span-1">
            <p className="text-rose-100 text-xs">Total Cancelled</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(total)}</p>
            <p className="text-rose-200 text-xs mt-1">{filtered.length} entries</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs">⏳ Pending</p>
            <p className="text-lg font-bold mt-1 text-orange-600">{pending}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs">✅ Approved</p>
            <p className="text-lg font-bold mt-1 text-green-700">{filtered.filter((c) => c.status === 'APPROVED').length}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs">✕ Rejected</p>
            <p className="text-lg font-bold mt-1 text-red-700">{filtered.filter((c) => c.status === 'REJECTED').length}</p>
          </div>
        </div>

        <SearchBox value={search} onChange={setSearch} placeholder="Search by staff, product or reason…" />
        <DateRangeFilter range={range} setRange={setRange} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-600">View:</span>
          {([['none', 'Detailed'], ['staff', 'By Staff'], ['product', 'By Product']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setGroupBy(k)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${groupBy === k ? 'bg-indigo-600 text-white shadow' : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300'}`}>{label}</button>
          ))}
          <span className="w-px bg-gray-200 h-6 mx-1" />
          {['', 'PENDING', 'APPROVED', 'REJECTED'].map((s) => (
            <button key={s || 'all'} onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition ${statusFilter === s ? 'bg-gray-800 text-white' : 'bg-white border-2 border-gray-200 text-gray-600'}`}>{s || 'All'}</button>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : groupBy !== 'none' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">{groupBy === 'staff' ? 'Staff' : 'Product'}</th>
                    <th className="px-4 py-3 font-semibold text-right">Entries</th>
                    <th className="px-4 py-3 font-semibold text-right">Qty</th>
                    <th className="px-4 py-3 font-semibold text-right">Amount</th>
                    <th className="px-4 py-3 font-semibold text-right">✅/⏳/✕</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {grouped.map((g) => (
                    <tr key={g.key} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{g.key}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{g.count}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{g.qty}</td>
                      <td className="px-4 py-3 text-right font-bold text-rose-700">{formatCurrency(g.amount)}</td>
                      <td className="px-4 py-3 text-right text-xs"><span className="text-green-600">{g.approved}</span> / <span className="text-orange-600">{g.pending}</span> / <span className="text-red-600">{g.rejected}</span></td>
                    </tr>
                  ))}
                  {grouped.length === 0 && <tr><td colSpan={5} className="text-center py-12 text-gray-400">No cancellations in this period</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Staff</th>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 font-semibold">Reason</th>
                    <th className="px-4 py-3 font-semibold text-right">Qty</th>
                    <th className="px-4 py-3 font-semibold text-right">Amount</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    {canApprove && <th className="px-4 py-3 font-semibold text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(c.date)}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{c.staffName}</td>
                      <td className="px-4 py-3 text-gray-700">{c.productName}</td>
                      <td className="px-4 py-3 text-gray-500">{c.reason}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{c.quantity}</td>
                      <td className="px-4 py-3 text-right font-bold text-rose-700">{formatCurrency(c.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${STATUS_STYLE[c.status] || STATUS_STYLE.PENDING}`}>
                          {c.status === 'APPROVED' ? `✓ ${c.approvedBy || 'Approved'}` : c.status === 'REJECTED' ? `✕ ${c.approvedBy || 'Rejected'}` : 'Pending'}
                        </span>
                      </td>
                      {canApprove && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {c.status === 'PENDING' ? (
                            <>
                              <button onClick={() => act(c.id, 'approve')} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 mr-1">Approve</button>
                              <button onClick={() => act(c.id, 'reject')} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100">Reject</button>
                            </>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={canApprove ? 8 : 7} className="text-center py-12 text-gray-400">No cancellations in this period</td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                    <tr>
                      <td className="px-4 py-3" colSpan={5}>TOTAL ({filtered.length})</td>
                      <td className="px-4 py-3 text-right text-rose-700">{formatCurrency(total)}</td>
                      <td className="px-4 py-3" colSpan={canApprove ? 2 : 1}></td>
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

export default function Page() {
  return (
    <Suspense fallback={<AppShell><div className="py-12 text-center text-gray-400">Loading…</div></AppShell>}>
      <CancellationsPage />
    </Suspense>
  )
}
