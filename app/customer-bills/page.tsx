'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, BILLS_TABS } from '@/components/Layout/SectionTabs'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { SearchBox } from '@/components/SearchBox'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { ExportBar } from '@/components/ExportBar'
import { RangeKey, inRange } from '@/lib/dateRange'
import { useBusinessMonth } from '@/hooks/useBusinessMonth'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { notifyPendingCountsChanged } from '@/lib/pendingBellEvents'

interface BillItem { productName: string; quantity: number; amount: number }
interface Bill {
  id: string; date: string; personName: string; serviceStaff: string
  amount: number; status: string; approvedBy: string; outletName: string; description: string; items?: BillItem[]
}
interface Staff { id: string; name: string; type: string }
interface Product { id: string; name: string; sellingPrice: number; isActive: boolean }
interface ItemRow { productId: string; productName: string; unitPrice: number; quantity: string }

const STATUS_STYLE: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  PENDING: 'bg-orange-100 text-orange-700',
}

function CustomerBillsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const searchParams = useSearchParams()
  const [items, setItems] = useState<Bill[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<RangeKey>('month')
  const bizMonth = useBusinessMonth()
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [statusFilter, setStatusFilter] = useState('')
  const [groupBy, setGroupBy] = useState<'none' | 'staff' | 'customer' | 'product'>('none')
  const [staff, setStaff] = useState<Staff[]>([])
  const [persons, setPersons] = useState<Staff[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ serviceStaff: '', personName: '', amount: '' })
  const [itemRows, setItemRows] = useState<ItemRow[]>([])
  const itemsTotal = itemRows.reduce((s, r) => s + r.unitPrice * (Number(r.quantity) || 0), 0)
  const hasItems = itemRows.some((r) => r.productName && Number(r.quantity) > 0)

  const canApprove = ['ACCOUNTANT', 'MANAGER', 'ADMIN', 'DIRECTOR'].includes(user?.role || '')
  const ownerEmail = (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
  const myEmail = (user?.email || '').toLowerCase()
  const canCreate = user?.role === 'CASHIER' || myEmail === 'alphonce.mvungi@tips.co.tz' || (!!ownerEmail && myEmail === ownerEmail)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, ppl, prods] = await Promise.all([request('/api/customer-bills'), request('/api/persons'), request('/api/products')])
      setItems(rows || [])
      setStaff((ppl || []).filter((p: Staff) => p.type === 'STAFF_LOSS').sort((a: Staff, b: Staff) => a.name.localeCompare(b.name)))
      setPersons((ppl || []).filter((p: Staff) => p.type === 'CUSTOMER'))
      setProducts((prods || []).filter((p: Product) => p.isActive))
    } finally { setLoading(false) }
  }, [request])

  const submitRequest = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.personName) return toast.error('Customer name is required')
    if (!hasItems && (!form.amount || Number(form.amount) <= 0)) return toast.error('Add a product line or enter an amount')
    setSubmitting(true)
    try {
      const items = itemRows.filter((r) => r.productName && Number(r.quantity) > 0).map((r) => ({ productId: r.productId || undefined, productName: r.productName, unitPrice: r.unitPrice, quantity: Number(r.quantity) }))
      await request('/api/customer-bills', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount) || 0, items }) })
      toast.success('Customer bill request filed')
      setForm({ serviceStaff: '', personName: '', amount: '' }); setItemRows([]); setShowForm(false); load()
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
      await request(`/api/customer-bills/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      toast.success(action === 'approve' ? 'Bill approved' : 'Bill rejected')
      load()
      notifyPendingCountsChanged()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Error updating') }
  }

  const q = search.trim().toLowerCase()
  const filtered = items.filter((b) => {
    if (!inRange(b.date, range, customFrom, customTo, bizMonth.range)) return false
    if (statusFilter && b.status !== statusFilter) return false
    if (q && !`${b.serviceStaff} ${b.personName}`.toLowerCase().includes(q)) return false
    return true
  })

  const total = filtered.reduce((s, b) => s + b.amount, 0)
  const pending = filtered.filter((b) => b.status === 'PENDING').length

  const grouped = (() => {
    if (groupBy === 'none') return []
    const m = new Map<string, { key: string; count: number; amount: number; approved: number; rejected: number; pending: number }>()
    const add = (key: string, amount: number, status: string) => {
      let r = m.get(key)
      if (!r) { r = { key, count: 0, amount: 0, approved: 0, rejected: 0, pending: 0 }; m.set(key, r) }
      r.count++; r.amount += amount
      if (status === 'APPROVED') r.approved++; else if (status === 'REJECTED') r.rejected++; else r.pending++
    }
    for (const b of filtered) {
      if (groupBy === 'product') {
        if (b.items && b.items.length) b.items.forEach((it) => add(it.productName, it.amount, b.status))
        else add('(No product)', b.amount, b.status)
      } else {
        add(groupBy === 'staff' ? b.serviceStaff : b.personName, b.amount, b.status)
      }
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount)
  })()

  const exportRows = filtered.map((b) => ({
    Date: formatDate(b.date), Staff: b.serviceStaff, Customer: b.personName,
    Amount: b.amount, Status: b.status, 'Approved/By': b.approvedBy, Outlet: b.outletName,
  }))

  return (
    <AppShell>
      <SectionTabs tabs={BILLS_TABS} />
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Customer Bills Requests</h1>
            <p className="text-gray-500 text-sm">Customer bill requests by staff, customer and status</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {canCreate && (
              <button onClick={() => setShowForm((s) => !s)} className="px-5 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition shadow">➕ Add Customer Bill</button>
            )}
            <ExportBar rows={exportRows} filename={`customer-bills-${format(new Date(), 'yyyy-MM-dd')}`} title="Customer Bills Report" />
          </div>
        </div>

        {showForm && canCreate && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h2 className="font-semibold text-gray-800 mb-3">👤 New Customer Bill Request</h2>
            <form onSubmit={submitRequest} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Service Staff</label>
                  <select value={form.serviceStaff} onChange={(e) => setForm({ ...form, serviceStaff: e.target.value })}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white text-sm">
                    <option value="">Select staff…</option>
                    {staff.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Customer *</label>
                  <input list="customerNames" value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })}
                    className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" placeholder="Customer name" />
                  <datalist id="customerNames">{persons.map((p) => <option key={p.id} value={p.name} />)}</datalist>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">Amount (TZS) {hasItems && <span className="text-gray-400 font-normal">auto</span>}</label>
                  {hasItems ? (
                    <div className="w-full px-3 py-2.5 border-2 border-gray-100 rounded-xl bg-gray-50 text-sm font-bold">{formatCurrency(itemsTotal)}</div>
                  ) : (
                    <input type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                      className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" placeholder="0" />
                  )}
                </div>
              </div>

              {/* Optional product line items */}
              <div className="border-2 border-gray-100 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-gray-600">🧾 Products (optional — itemise)</span>
                  <button type="button" onClick={() => setItemRows([...itemRows, { productId: '', productName: '', unitPrice: 0, quantity: '' }])}
                    className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">➕ Add Product</button>
                </div>
                {itemRows.map((r, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                    <select value={r.productId} onChange={(e) => { const p = products.find((x) => x.id === e.target.value); const n = [...itemRows]; n[i] = { ...r, productId: e.target.value, productName: p?.name || '', unitPrice: p?.sellingPrice || 0 }; setItemRows(n) }}
                      className="col-span-6 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white">
                      <option value="">Select product…</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatCurrency(p.sellingPrice)}</option>)}
                    </select>
                    <input type="number" min="0" placeholder="Qty" value={r.quantity} onChange={(e) => { const n = [...itemRows]; n[i] = { ...r, quantity: e.target.value }; setItemRows(n) }} className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                    <span className="col-span-2 text-sm font-semibold text-right">{formatCurrency(r.unitPrice * (Number(r.quantity) || 0))}</span>
                    <button type="button" onClick={() => setItemRows(itemRows.filter((_, x) => x !== i))} className="col-span-1 text-red-500 hover:text-red-700 font-bold">✕</button>
                  </div>
                ))}
                {itemRows.length === 0 && <p className="text-xs text-gray-400">No products — the manual Amount above will be used.</p>}
              </div>

              <div className="flex gap-2">
                <button type="submit" disabled={submitting} className="px-6 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">{submitting ? 'Saving…' : 'File Request'}</button>
                <button type="button" onClick={() => { setShowForm(false); setItemRows([]) }} className="px-5 py-2.5 border-2 border-gray-200 text-gray-700 rounded-xl hover:bg-gray-50">Cancel</button>
                <span className="text-xs text-gray-400 self-center">Filed as Pending → manager/accountant approves.</span>
              </div>
            </form>
          </div>
        )}

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-green-600 to-emerald-700 text-white rounded-2xl p-4 shadow col-span-2 sm:col-span-1">
            <p className="text-green-100 text-xs">Total Customer Bills</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(total)}</p>
            <p className="text-green-200 text-xs mt-1">{filtered.length} requests</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs">⏳ Pending</p>
            <p className="text-lg font-bold mt-1 text-orange-600">{pending}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs">✅ Approved</p>
            <p className="text-lg font-bold mt-1 text-green-700">{filtered.filter((b) => b.status === 'APPROVED').length}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs">✕ Rejected</p>
            <p className="text-lg font-bold mt-1 text-red-700">{filtered.filter((b) => b.status === 'REJECTED').length}</p>
          </div>
        </div>

        <SearchBox value={search} onChange={setSearch} placeholder="Search by staff or customer…" />
        <DateRangeFilter range={range} setRange={setRange} customFrom={customFrom} setCustomFrom={setCustomFrom} customTo={customTo} setCustomTo={setCustomTo} businessMonthLabel={bizMonth.label} />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-600">View:</span>
          {([['none', 'Detailed'], ['staff', 'By Staff'], ['customer', 'By Customer'], ['product', 'By Product']] as const).map(([k, label]) => (
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
                    <th className="px-4 py-3 font-semibold">{groupBy === 'staff' ? 'Staff' : groupBy === 'product' ? 'Product' : 'Customer'}</th>
                    <th className="px-4 py-3 font-semibold text-right">Requests</th>
                    <th className="px-4 py-3 font-semibold text-right">Amount</th>
                    <th className="px-4 py-3 font-semibold text-right">✅/⏳/✕</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {grouped.map((g) => (
                    <tr key={g.key} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{g.key}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{g.count}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-700">{formatCurrency(g.amount)}</td>
                      <td className="px-4 py-3 text-right text-xs"><span className="text-green-600">{g.approved}</span> / <span className="text-orange-600">{g.pending}</span> / <span className="text-red-600">{g.rejected}</span></td>
                    </tr>
                  ))}
                  {grouped.length === 0 && <tr><td colSpan={4}><EmptyState icon="👤" title="No customer bills in this period" /></td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Customer</th>
                    <th className="px-4 py-3 font-semibold">Staff</th>
                    <th className="px-4 py-3 font-semibold text-right">Amount</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    {canApprove && <th className="px-4 py-3 font-semibold text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{formatDate(b.date)}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{b.personName}</td>
                      <td className="px-4 py-3 text-gray-700">{b.serviceStaff}</td>
                      <td className="px-4 py-3 text-right font-bold text-green-700">{formatCurrency(b.amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${STATUS_STYLE[b.status] || STATUS_STYLE.PENDING}`}>
                          {b.status === 'APPROVED' ? `✓ ${b.approvedBy || 'Approved'}` : b.status === 'REJECTED' ? `✕ ${b.approvedBy || 'Rejected'}` : 'Pending'}
                        </span>
                      </td>
                      {canApprove && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {b.status === 'PENDING' ? (
                            <>
                              <Button onClick={() => act(b.id, 'approve')} variant="success" size="sm" className="mr-1">Approve</Button>
                              <Button onClick={() => act(b.id, 'reject')} variant="danger" size="sm">Reject</Button>
                            </>
                          ) : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={canApprove ? 6 : 5}><EmptyState icon="👤" title="No customer bills in this period" hint="Filed customer bills will appear here for approval." /></td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200 font-bold text-gray-900">
                    <tr>
                      <td className="px-4 py-3" colSpan={3}>TOTAL ({filtered.length})</td>
                      <td className="px-4 py-3 text-right text-green-700">{formatCurrency(total)}</td>
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
      <CustomerBillsPage />
    </Suspense>
  )
}
