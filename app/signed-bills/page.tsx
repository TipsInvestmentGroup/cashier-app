'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, BILL_TYPE_COLORS, BILL_TYPE_LABELS, STATUS_COLORS } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { SearchBox } from '@/components/SearchBox'
import { RangeKey, RANGE_OPTIONS, inRange } from '@/lib/dateRange'

interface Bill {
  id: string; voucherNumber: string; date: string; billType: string; personName: string
  amount: number; serviceStaff: string; description: string; status: string
  outlet: { name: string }; cashier: { name: string }; dueDate?: string
  limitExceeded?: boolean; exceededAmount?: number
}
interface Outlet { id: string; name: string }
interface Person { id: string; name: string; type: string; creditLimit: number }

const BILL_TYPES = [
  { value: 'ADMIN', label: '🏢 Admin Bill', color: 'bg-blue-600' },
  { value: 'DIRECTOR', label: '👔 Director Bill', color: 'bg-purple-600' },
  { value: 'CUSTOMER', label: '👤 Customer Bill', color: 'bg-green-600' },
  { value: 'TIPS', label: '🎁 Tips Bill', color: 'bg-yellow-600' },
  { value: 'DJ', label: '🎵 DJ Bill', color: 'bg-pink-600' },
  { value: 'STAFF_LOSS', label: '⚠️ Staff Loss', color: 'bg-red-600' },
]

const INIT_FORM = {
  billType: 'CUSTOMER', personId: '', personName: '', amount: '', serviceStaff: '',
  description: '', dueDate: '', outletId: '', date: format(new Date(), 'yyyy-MM-dd'),
}

export default function SignedBillsPage() {
  const { request } = useApi()
  const { user } = useAuth()
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
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [form, setForm] = useState(INIT_FORM)
  const [limitWarning, setLimitWarning] = useState<{ exceeded: boolean; amount: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [b, o, p] = await Promise.all([
      request('/api/signed-bills'),
      request('/api/outlets'),
      request('/api/persons'),
    ])
    setBills(b)
    setOutlets(o)
    setPersons(p)
    if (o.length && !form.outletId) setForm((f) => ({ ...f, outletId: user?.outlet?.id || o[0].id }))
    setLoading(false)
  }, [request, user])

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
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Amount must be > 0')
    setSubmitting(true)
    try {
      const res = await request('/api/signed-bills', {
        method: 'POST',
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
      })
      if (res.limitExceeded) {
        setLimitWarning({ exceeded: true, amount: res.exceededAmount })
        toast.error(`⚠️ Credit limit exceeded by ${formatCurrency(res.exceededAmount)}!`)
      } else {
        toast.success(`Bill saved! Voucher: ${res.voucherNumber}`)
      }
      setForm({ ...INIT_FORM, outletId: form.outletId })
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving bill')
    } finally {
      setSubmitting(false)
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = bills.filter((b) => {
    if (filterType && b.billType !== filterType) return false
    if (filterStatus && b.status !== filterStatus) return false
    if (!inRange(b.date, range, customFrom, customTo)) return false
    if (q && !(`${b.personName} ${b.voucherNumber} ${b.serviceStaff || ''}`.toLowerCase().includes(q))) return false
    return true
  })

  const totalAmount = filtered.reduce((s, b) => s + b.amount, 0)
  const unpaidAmount = filtered.filter((b) => b.status !== 'PAID').reduce((s, b) => s + b.amount, 0)
  const paidCount = filtered.filter((b) => b.status === 'PAID').length

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Signed Bills</h1>
            <p className="text-gray-500 text-sm">Record unpaid/credit sales vouchers</p>
          </div>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
            <span className="text-lg">+</span> New Bill
          </button>
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
                  <input type="number" min="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-xl font-bold"
                    placeholder="0" required />
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
                <button type="button" onClick={() => setShowForm(false)}
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
          customTo={customTo} setCustomTo={setCustomTo} />

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
                    <th className="px-4 py-3 font-semibold">Voucher</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Type</th>
                    <th className="px-4 py-3 font-semibold">Person</th>
                    <th className="px-4 py-3 font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Staff</th>
                    <th className="px-4 py-3 font-semibold">Outlet</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((b) => (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{b.voucherNumber}</td>
                      <td className="px-4 py-3 text-gray-600">{formatDate(b.date)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${BILL_TYPE_COLORS[b.billType]}`}>
                          {BILL_TYPE_LABELS[b.billType]}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-800">{b.personName}</td>
                      <td className="px-4 py-3 font-bold text-gray-900">{formatCurrency(b.amount)}</td>
                      <td className="px-4 py-3 text-gray-500">{b.serviceStaff || '-'}</td>
                      <td className="px-4 py-3 text-gray-500">{b.outlet.name}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${STATUS_COLORS[b.status]}`}>
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-400">No bills found</td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="font-bold text-gray-900">
                      <td className="px-4 py-3" colSpan={4}>TOTAL ({filtered.length})</td>
                      <td className="px-4 py-3 text-indigo-700">{formatCurrency(totalAmount)}</td>
                      <td className="px-4 py-3" colSpan={3}></td>
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
