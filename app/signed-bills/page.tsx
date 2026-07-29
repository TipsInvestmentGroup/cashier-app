'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, BILLS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, BILL_TYPE_LABELS } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { SearchBox } from '@/components/SearchBox'
import { MoneyInput } from '@/components/MoneyInput'
import { PaymentStoryModal } from '@/components/PaymentStoryModal'
import { RangeKey, RANGE_OPTIONS, inRange } from '@/lib/dateRange'
import { useBusinessMonth } from '@/hooks/useBusinessMonth'
import { Pencil, Trash2, ShieldCheck } from 'lucide-react'
import { ManageAccessModal } from '@/components/ManageAccessModal'

interface Bill {
  id: string; voucherNumber?: string | null; displayReference?: string | null; legacyReference?: string | null
  date: string; billType: string; personName: string
  amount: number; serviceStaff: string; description: string; status: string; seq?: number
  outlet: { name: string }; cashier: { name: string }; dueDate?: string
  limitExceeded?: boolean; exceededAmount?: number
}
interface Outlet { id: string; name: string }
interface Person { id: string; name: string; type: string; creditLimit: number }
interface Product { id: string; name: string; sellingPrice: number; isActive: boolean }
interface ItemRow { productId: string; productName: string; unitPrice: number; quantity: string }

interface Category { code: string; label: string; isActive: boolean }
const TYPE_COLOR: Record<string, string> = {
  ADMIN: 'bg-blue-600', DIRECTOR: 'bg-purple-600', CUSTOMER: 'bg-green-600',
  TIPS: 'bg-yellow-600', DJ: 'bg-pink-600', STAFF_LOSS: 'bg-red-600',
}

const INIT_FORM = {
  billType: 'CUSTOMER', personId: '', personName: '', amount: '', serviceStaff: '',
  description: '', dueDate: '', outletId: '', date: format(new Date(), 'yyyy-MM-dd'),
}

export default function SignedBillsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const confirm = useConfirm()
  const [bills, setBills] = useState<Bill[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [persons, setPersons] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [range, setRange] = useState<RangeKey>('month')
  const bizMonth = useBusinessMonth()
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [form, setForm] = useState(INIT_FORM)
  const [limitWarning, setLimitWarning] = useState<{ exceeded: boolean; amount: number } | null>(null)
  const [storyBillId, setStoryBillId] = useState<string | null>(null)
  const [editBillId, setEditBillId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(INIT_FORM)
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [itemRows, setItemRows] = useState<ItemRow[]>([])
  const [perms, setPerms] = useState<{ canEdit: boolean; canDelete: boolean }>({ canEdit: false, canDelete: false })
  const [accessOpen, setAccessOpen] = useState(false)
  const itemsTotal = itemRows.reduce((s, r) => s + r.unitPrice * (Number(r.quantity) || 0), 0)
  const hasItems = itemRows.some((r) => r.productName && Number(r.quantity) > 0)
  const BILL_TYPES = categories.filter((c) => c.isActive).map((c) => ({ value: c.code, label: c.label, color: TYPE_COLOR[c.code] || 'bg-gray-600' }))
  const typeLabel = (code: string) => categories.find((c) => c.code === code)?.label || BILL_TYPE_LABELS[code] || code
  const isOwner = (user?.email || '').toLowerCase() === (process.env.NEXT_PUBLIC_OWNER_EMAIL || '').toLowerCase()
  // Edit/delete visibility: superuser always, cashier while the day allows it (server has final say),
  // or an account explicitly granted access via Manage Access. r.mlay@tips.co.tz explicitly blocked otherwise.
  const canManageBills = (user?.email !== 'r.mlay@tips.co.tz' && (user?.email === 'johnonecmo@gmail.com' || user?.role === 'CASHIER'))
    || perms.canEdit || perms.canDelete

  const load = useCallback(async () => {
    setLoading(true)
    const [b, o, p, cats, prods, me] = await Promise.all([
      request('/api/signed-bills'),
      request('/api/outlets'),
      request('/api/persons'),
      request('/api/person-categories'),
      request('/api/products'),
      request('/api/permissions/me'),
    ])
    setBills(b)
    setOutlets(o)
    setPersons(p)
    setCategories(cats || [])
    setProducts((prods || []).filter((x: Product) => x.isActive))
    setPerms({ canEdit: !!me?.SIGNED_BILLS?.canEdit, canDelete: !!me?.SIGNED_BILLS?.canDelete })
    if (o.length && !form.outletId) setForm((f) => ({ ...f, outletId: user?.outlet?.id || o[0].id }))
    setLoading(false)
  }, [request, user, form.outletId])

  useEffect(() => { load() }, [load])

  const filteredPersons = persons.filter((p) => !form.billType || p.type === form.billType)
  // Service Staff = the imported staff list (STAFF_LOSS type)
  const staffList = persons
    .filter((p) => p.type === 'STAFF_LOSS')
    .sort((a, b) => a.name.localeCompare(b.name))

  const handlePersonSelect = (personId: string) => {
    const p = persons.find((x) => x.id === personId)
    setForm((f) => ({ ...f, personId, personName: p?.name || '' }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.personName) return toast.error('Person name is required')
    const effectiveAmount = hasItems ? itemsTotal : Number(form.amount)
    if (!effectiveAmount || effectiveAmount <= 0) return toast.error('Amount must be > 0 (add a product line or enter an amount)')
    setSubmitting(true)
    try {
      const items = itemRows.filter((r) => r.productName && Number(r.quantity) > 0).map((r) => ({ productId: r.productId || undefined, productName: r.productName, unitPrice: r.unitPrice, quantity: Number(r.quantity) }))
      const res = await request('/api/signed-bills', {
        method: 'POST',
        body: JSON.stringify({ ...form, amount: effectiveAmount, items }),
      })
      if (res.limitExceeded) {
        setLimitWarning({ exceeded: true, amount: res.exceededAmount })
        toast.error(`⚠️ Credit limit exceeded by ${formatCurrency(res.exceededAmount)}!`)
      } else {
        toast.success(`Bill saved! Reference: ${res.displayReference || res.voucherNumber}`)
      }
      setForm({ ...INIT_FORM, outletId: form.outletId })
      setItemRows([])
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving bill')
    } finally {
      setSubmitting(false)
    }
  }

  const openEdit = (b: Bill) => {
    setEditForm({
      billType: b.billType, personId: '', personName: b.personName, amount: String(b.amount),
      serviceStaff: b.serviceStaff || '', description: b.description || '',
      dueDate: b.dueDate ? format(new Date(b.dueDate), 'yyyy-MM-dd') : '',
      outletId: '', date: format(new Date(b.date), 'yyyy-MM-dd'),
    })
    setEditBillId(b.id)
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editBillId) return
    if (!editForm.personName) return toast.error('Person name is required')
    const amt = Number(editForm.amount)
    if (!amt || amt <= 0) return toast.error('Amount must be > 0')
    setEditSubmitting(true)
    try {
      await request(`/api/signed-bills/${editBillId}`, { method: 'PUT', body: JSON.stringify(editForm) })
      toast.success('Bill updated')
      setEditBillId(null)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error updating bill')
    } finally {
      setEditSubmitting(false)
    }
  }

  const deleteBill = async (b: Bill) => {
    if (!(await confirm({
      title: 'Delete signed bill',
      message: `Delete the bill for ${b.personName} (${formatCurrency(b.amount)})? This cannot be undone.`,
      danger: true, confirmLabel: 'Delete',
    }))) return
    try {
      await request(`/api/signed-bills/${b.id}`, { method: 'DELETE' })
      toast.success('Bill deleted')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error deleting bill')
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = bills.filter((b) => {
    if (filterType && b.billType !== filterType) return false
    if (filterStatus && b.status !== filterStatus) return false
    if (!inRange(b.date, range, customFrom, customTo, bizMonth.range)) return false
    if (q && !(`${b.personName} ${b.voucherNumber || ''} ${b.displayReference || ''} ${b.legacyReference || ''} ${b.serviceStaff || ''}`.toLowerCase().includes(q))) return false
    return true
  })

  const totalAmount = filtered.reduce((s, b) => s + b.amount, 0)
  const unpaidAmount = filtered.filter((b) => b.status !== 'PAID').reduce((s, b) => s + b.amount, 0)
  const paidCount = filtered.filter((b) => b.status === 'PAID').length

  return (
    <AppShell>
      <SectionTabs tabs={BILLS_TABS} />
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Signed Bills</h1>
            <p className="text-gray-500 text-sm">Record unpaid/credit sales vouchers</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
              <span className="text-lg">+</span> New Bill
            </button>
            {isOwner && (
              <button onClick={() => setAccessOpen(true)} title="Manage Edit/Delete Access (Signed Bills)"
                className="p-3 bg-white border-2 border-gray-200 text-gray-600 rounded-xl hover:border-gray-300 transition">
                <ShieldCheck className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {limitWarning?.exceeded && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-4 flex items-start gap-3">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-bold text-red-800">Credit Limit Exceeded!</p>
              <p className="text-red-700 text-sm">Exceeded by {formatCurrency(limitWarning.amount)}. A salary deduction report will be generated.</p>
            </div>
            <button onClick={() => setLimitWarning(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Search */}
        <SearchBox value={search} onChange={setSearch} placeholder="Search bills by name, voucher or staff…" />

        {/* Bill Type Quick Select */}
        <div className="flex gap-2 flex-wrap">
          {BILL_TYPES.map((t) => (
            <button key={t.value} onClick={() => setFilterType(filterType === t.value ? '' : t.value)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition ${filterType === t.value ? `${t.color} text-white` : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300'}`}>
              {t.label}
            </button>
          ))}
          <button onClick={() => setFilterStatus(filterStatus === 'UNPAID' ? '' : 'UNPAID')}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition ${filterStatus === 'UNPAID' ? 'bg-red-500 text-white' : 'bg-white border-2 border-gray-200 text-gray-700 hover:border-gray-300'}`}>
            🔴 Unpaid Only
          </button>
        </div>

        {/* Form */}
        {showForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-5">New Signed Bill</h2>

            {/* Bill Type Selector */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
              {BILL_TYPES.map((t) => (
                <button key={t.value} type="button"
                  onClick={() => setForm({ ...form, billType: t.value, personId: '', personName: '' })}
                  className={`py-3 px-2 rounded-xl text-sm font-medium transition text-center ${form.billType === t.value ? `${t.color} text-white shadow-lg scale-105` : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                  {t.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    {form.billType === 'ADMIN' ? 'Admin Name' : form.billType === 'DIRECTOR' ? 'Director Name' : 'Person Name'} *
                  </label>
                  {filteredPersons.length > 0 ? (
                    <select value={form.personId} onChange={(e) => handlePersonSelect(e.target.value)}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none">
                      <option value="">-- Select or type name --</option>
                      {filteredPersons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  ) : null}
                  <input type="text" value={form.personName}
                    onChange={(e) => setForm({ ...form, personName: e.target.value, personId: '' })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none mt-2"
                    placeholder="Type name..." required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Amount (TZS) *</label>
                  {hasItems ? (
                    <div className="w-full px-4 py-3 border-2 border-gray-100 rounded-xl bg-gray-50 text-xl font-bold text-gray-800 flex items-center justify-between">
                      <span>{formatCurrency(itemsTotal)}</span>
                      <span className="text-[11px] font-normal text-gray-400">auto · from products</span>
                    </div>
                  ) : (
                    <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-xl font-bold"
                      placeholder="0" />
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Service Staff</label>
                  <select value={form.serviceStaff} onChange={(e) => setForm({ ...form, serviceStaff: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                    <option value="">-- Select staff --</option>
                    {staffList.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>
                {form.billType === 'CUSTOMER' && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Due Date</label>
                    <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                  </div>
                )}
              </div>

              {/* Product line items (optional) */}
              <div className="border-2 border-gray-100 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-gray-700 text-sm">🧾 Products <span className="text-gray-400 font-normal">(optional — itemise the bill)</span></span>
                  <button type="button" onClick={() => setItemRows([...itemRows, { productId: '', productName: '', unitPrice: 0, quantity: '' }])}
                    className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">➕ Add Product</button>
                </div>
                {itemRows.length === 0 && <p className="text-xs text-gray-400">Add products to itemise this bill — the Amount becomes their total. Leave empty to type a manual amount.</p>}
                {itemRows.length > 0 && (
                  <div className="hidden sm:grid grid-cols-12 gap-2 text-[11px] font-semibold text-gray-400 mb-1">
                    <span className="col-span-5">Product</span><span className="col-span-3">Qty</span><span className="col-span-3 text-right">Amount</span><span className="col-span-1"></span>
                  </div>
                )}
                {itemRows.map((r, i) => {
                  const amt = r.unitPrice * (Number(r.quantity) || 0)
                  return (
                    <div key={i} className="grid grid-cols-12 gap-2 mb-2 items-center">
                      <select value={r.productId} onChange={(e) => { const p = products.find((x) => x.id === e.target.value); const n = [...itemRows]; n[i] = { ...r, productId: e.target.value, productName: p?.name || '', unitPrice: p?.sellingPrice || 0 }; setItemRows(n) }}
                        className="col-span-5 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm bg-white">
                        <option value="">Select product…</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatCurrency(p.sellingPrice)}</option>)}
                      </select>
                      <input type="number" min="0" placeholder="Qty" value={r.quantity} onChange={(e) => { const n = [...itemRows]; n[i] = { ...r, quantity: e.target.value }; setItemRows(n) }}
                        className="col-span-3 px-2 py-2 border-2 border-gray-200 rounded-lg text-sm" />
                      <span className="col-span-3 text-sm font-semibold text-gray-700 text-right pr-1">{formatCurrency(amt)}</span>
                      <button type="button" onClick={() => setItemRows(itemRows.filter((_, x) => x !== i))} className="col-span-1 text-red-500 hover:text-red-700 font-bold">✕</button>
                    </div>
                  )
                })}
                {hasItems && <p className="text-xs text-gray-500 mt-1">Items total: <strong>{formatCurrency(itemsTotal)}</strong></p>}
                {products.length === 0 && <p className="text-xs text-amber-600 mt-1">No products yet — add some under <strong>Products</strong> to itemise bills.</p>}
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                  rows={2} placeholder="What was ordered / reason..." />
              </div>

              <div className="flex gap-3">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                  {submitting ? 'Saving...' : 'Save Signed Bill'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setItemRows([]) }}
                  className="px-6 py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Date Range Filter */}
        <DateRangeFilter range={range} setRange={setRange}
          customFrom={customFrom} setCustomFrom={setCustomFrom}
          customTo={customTo} setCustomTo={setCustomTo} businessMonthLabel={bizMonth.label} />

        {/* Totals Summary */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white rounded-2xl p-4 shadow">
            <p className="text-indigo-100 text-xs font-medium">Total Signed Bills</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(totalAmount)}</p>
            <p className="text-indigo-200 text-xs mt-1">{filtered.length} bill{filtered.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs font-medium">🔴 Outstanding (Unpaid)</p>
            <p className="text-lg font-bold mt-1 text-red-600">{formatCurrency(unpaidAmount)}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs font-medium">✅ Settled Bills</p>
            <p className="text-lg font-bold mt-1 text-green-700">{paidCount}</p>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
            <p className="text-gray-500 text-xs font-medium">📅 Period</p>
            <p className="text-lg font-bold mt-1 text-gray-800">{RANGE_OPTIONS.find((r) => r.key === range)?.label}</p>
          </div>
        </div>

        {/* List */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">
              {filtered.length} Bills {filterType || filterStatus ? '(filtered)' : ''}
            </h2>
            <span className="text-sm text-gray-500">
              Total: <strong>{formatCurrency(totalAmount)}</strong>
            </span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">#</th>
                    <th className="px-4 py-3 font-semibold">Reference</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Person</th>
                    <th className="px-4 py-3 font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Staff</th>
                    <th className="px-4 py-3 font-semibold">Outlet</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    {canManageBills && <th className="px-4 py-3 font-semibold text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((b) => (
                    <tr key={b.id} onClick={() => setStoryBillId(b.id)} title="Click for the full payment story"
                      className="cursor-pointer hover:bg-indigo-50/60">
                      <td className="px-4 py-3 font-semibold text-gray-600">#{b.seq ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600">
                        <span className="font-mono text-xs">{b.displayReference || b.voucherNumber || '—'}</span>
                        {b.legacyReference && <div className="text-[10px] text-gray-400">formerly {b.legacyReference}</div>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(b.date)}</td>
                      <td className="px-4 py-3">
                        <Badge billType={b.billType}>{typeLabel(b.billType)}</Badge>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{b.personName}</td>
                      <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(b.amount)}</td>
                      <td className="px-4 py-3 text-gray-500">{b.serviceStaff || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{b.outlet.name}</td>
                      <td className="px-4 py-3">
                        <Badge status={b.status}>{b.status}</Badge>
                      </td>
                      {canManageBills && (
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => openEdit(b)} title="Edit bill" className="text-gray-400 hover:text-indigo-600">
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button onClick={() => deleteBill(b)} title="Delete bill" className="text-gray-400 hover:text-red-600">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={canManageBills ? 10 : 9}><EmptyState icon="📋" title="No bills found" hint="Record a signed bill or adjust your filters." /></td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="font-bold text-gray-900">
                      <td className="px-4 py-3" colSpan={5}>TOTAL ({filtered.length})</td>
                      <td className="px-4 py-3 text-indigo-700">{formatCurrency(totalAmount)}</td>
                      <td className="px-4 py-3" colSpan={canManageBills ? 4 : 3}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>

      <Modal open={!!editBillId} onClose={() => setEditBillId(null)} title="Edit Signed Bill">
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Person Name *</label>
            <input type="text" value={editForm.personName}
              onChange={(e) => setEditForm({ ...editForm, personName: e.target.value })}
              className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
              <input type="date" value={editForm.date} onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Amount (TZS) *</label>
              <MoneyInput value={editForm.amount} onChange={(v) => setEditForm({ ...editForm, amount: v })}
                className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none font-bold" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Service Staff</label>
            <select value={editForm.serviceStaff} onChange={(e) => setEditForm({ ...editForm, serviceStaff: e.target.value })}
              className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
              <option value="">-- Select staff --</option>
              {staffList.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Description</label>
            <textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              className="w-full px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" rows={2} />
          </div>
          <div className="flex gap-3">
            <button type="submit" disabled={editSubmitting}
              className="flex-1 py-2.5 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
              {editSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" onClick={() => setEditBillId(null)}
              className="px-6 py-2.5 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <PaymentStoryModal billId={storyBillId} request={request} onClose={() => setStoryBillId(null)} />

      {isOwner && (
        <ManageAccessModal open={accessOpen} onClose={() => setAccessOpen(false)} resource="SIGNED_BILLS"
          resourceLabel="Signed Bills" actions={['edit', 'delete']} request={request} />
      )}
    </AppShell>
  )
}
