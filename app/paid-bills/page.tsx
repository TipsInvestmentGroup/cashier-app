'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, BILLS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { SearchBox } from '@/components/SearchBox'
import { BillSelector, BillLite } from '@/components/BillSelector'
import { MoneyInput } from '@/components/MoneyInput'
import { RangeKey, RANGE_OPTIONS, inRange } from '@/lib/dateRange'

interface PaidBill {
  id: string; date: string; payerName: string; payerCategory?: string; amountPaid: number; paymentMethod: string
  outlet: { name: string }; cashier: { name: string }; notes?: string; billRef?: string
  signedBill?: { id: string; voucherNumber: string; amount: number; personName: string; date?: string; billType?: string }
}
interface Story {
  bill: { id: string; date: string; billType: string; personName: string; serviceStaff?: string; amount: number; status: string; description?: string; outlet?: { name: string }; cashier?: { name: string } }
  payments: { id: string; date: string; payerName: string; payerCategory?: string; amountPaid: number; paymentMethod: string; cashier?: { name: string } }[]
  totalPaid: number
  balance: number
}
interface SignedBill { id: string; voucherNumber: string; personName: string; amount: number; billType: string; status: string; seq?: number; date?: string }
interface Outlet { id: string; name: string }
interface Person { id: string; name: string; type: string }

interface Category { code: string; label: string; isActive: boolean }
interface Channel { code: string; label: string; isActive: boolean }
const METHOD_COLOR: Record<string, string> = {
  CASH: 'bg-green-100 text-green-800', CRDB: 'bg-blue-100 text-blue-800',
  STANBIC: 'bg-purple-100 text-purple-800', MPESA: 'bg-yellow-100 text-yellow-800',
  PAYROLL: 'bg-indigo-100 text-indigo-800',
}

export default function PaidBillsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [paidBills, setPaidBills] = useState<PaidBill[]>([])
  const [signedBills, setSignedBills] = useState<SignedBill[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [persons, setPersons] = useState<Person[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [range, setRange] = useState<RangeKey>('month')
  const [search, setSearch] = useState('')
  const [linkQuery, setLinkQuery] = useState('')
  const [linkOpen, setLinkOpen] = useState(false)
  const [selectedBillIds, setSelectedBillIds] = useState<string[]>([])
  // Payment-story modal
  const [storyOpen, setStoryOpen] = useState(false)
  const [story, setStory] = useState<Story | null>(null)
  const [creditOnly, setCreditOnly] = useState<PaidBill | null>(null)
  const [storyLoading, setStoryLoading] = useState(false)
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [form, setForm] = useState({
    signedBillId: '', payerCategory: '', categoryCode: '', payerName: '', amountPaid: '', paymentMethod: 'CASH',
    notes: '', outletId: user?.outlet?.id || '', date: format(new Date(), 'yyyy-MM-dd'), billRef: '',
  })
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const PAY_CATEGORIES = categories.filter((c) => c.isActive).map((c) => ({ label: c.label, type: c.code }))
  const PAYMENT_METHODS = channels.filter((c) => c.isActive).map((c) => ({ value: c.code, label: c.label, color: METHOD_COLOR[c.code] || 'bg-gray-100 text-gray-700' }))
    .concat([{ value: 'PAYROLL', label: 'Payroll', color: METHOD_COLOR.PAYROLL }])
  const codeToLabel = (code: string) => categories.find((c) => c.code === code)?.label || code

  const load = useCallback(async () => {
    setLoading(true)
    const [pb, sb, o, ps, cats, chs] = await Promise.all([
      request('/api/paid-bills'),
      request('/api/signed-bills?status=UNPAID'),
      request('/api/outlets'),
      request('/api/persons'),
      request('/api/person-categories'),
      request('/api/payment-channels'),
    ])
    setPaidBills(pb)
    setSignedBills(sb.filter((b: SignedBill) => b.status !== 'PAID'))
    setOutlets(o)
    setPersons(ps || [])
    setCategories(cats || [])
    setChannels(chs || [])
    if (o.length && !form.outletId) setForm((f) => ({ ...f, outletId: user?.outlet?.id || o[0].id }))
    setLoading(false)
  }, [request, user])

  useEffect(() => { load() }, [load])

  const handleBillSelect = (billId: string) => {
    const bill = signedBills.find((b) => b.id === billId)
    setForm((f) => ({
      ...f, signedBillId: billId,
      payerName: bill?.personName || f.payerName,
      payerCategory: bill ? codeToLabel(bill.billType) : f.payerCategory,
      categoryCode: bill ? bill.billType : f.categoryCode,
      amountPaid: bill?.amount?.toString() || f.amountPaid,
    }))
    setSelectedBillIds(billId ? [billId] : [])
  }

  // #3 Auto-link: when a known person is chosen as payer, pull in their category
  // so the payment matches and links to their bills (avoids unlinked credits).
  const applyPayer = (name: string) => {
    const person = persons.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())
    // If a bill is linked, its category is authoritative — don't override it.
    const locked = selectedBillIds.length > 0
    setForm((f) => ({
      ...f, payerName: name,
      ...(!locked && person ? { payerCategory: codeToLabel(person.type), categoryCode: person.type } : {}),
    }))
  }

  // Friendly label (date + per-person sequence #, no voucher) for the searchable linker
  const billLabel = (b: SignedBill) => `${b.date ? formatDate(b.date) : ''} · #${b.seq ?? '?'} — ${b.personName} — ${formatCurrency(b.amount)} [${b.billType.replace('_', ' ')}]`
  const selectBill = (b: SignedBill | null) => {
    if (!b) { setForm((f) => ({ ...f, signedBillId: '' })); setSelectedBillIds([]); setLinkQuery(''); setLinkOpen(false); return }
    handleBillSelect(b.id); setLinkQuery(billLabel(b)); setLinkOpen(false)
  }
  const lq = linkQuery.trim().toLowerCase()
  const linkFiltered = signedBills.filter((b) => {
    if (!lq) return true
    const hay = `${b.personName} ${b.billType} ${b.billType.replace('_', ' ')} ${b.date ? formatDate(b.date) : ''}`.toLowerCase()
    return hay.includes(lq)
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.payerName) return toast.error('Payer name required')
    if (!form.amountPaid || Number(form.amountPaid) <= 0) return toast.error('Amount must be > 0')
    setSubmitting(true)
    try {
      const res = await request('/api/paid-bills', {
        method: 'POST',
        body: JSON.stringify({ ...form, amountPaid: Number(form.amountPaid), selectedBillIds, categoryBillType: form.categoryCode }),
      })
      toast.success(res?.billsPaid > 0
        ? `Payment recorded — ${res.billsPaid} bill(s) settled${res.leftover > 0 ? `, ${formatCurrency(res.leftover)} credit` : ''}.`
        : 'Payment recorded successfully!')
      setForm({ signedBillId: '', payerCategory: '', categoryCode: '', payerName: '', amountPaid: '', paymentMethod: 'CASH', notes: '', outletId: form.outletId, date: format(new Date(), 'yyyy-MM-dd'), billRef: '' })
      setSelectedBillIds([])
      setLinkQuery('')
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error recording payment')
    } finally {
      setSubmitting(false)
    }
  }

  const openStory = async (p: PaidBill) => {
    setStoryOpen(true); setStory(null); setCreditOnly(null)
    if (p.signedBill?.id) {
      setStoryLoading(true)
      try { const res = await request(`/api/signed-bills/${p.signedBill.id}/story`); setStory(res) }
      catch { toast.error('Could not load payment story') }
      finally { setStoryLoading(false) }
    } else {
      setCreditOnly(p)
    }
  }

  const q = search.trim().toLowerCase()
  const filtered = paidBills.filter((p) => {
    if (!inRange(p.date, range, customFrom, customTo)) return false
    if (q && !(`${p.payerName} ${p.billRef || ''} ${p.signedBill?.voucherNumber || ''}`.toLowerCase().includes(q))) return false
    return true
  })
  const totalReceived = filtered.reduce((s, p) => s + p.amountPaid, 0)

  return (
    <AppShell>
      <SectionTabs tabs={BILLS_TABS} />
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Paid Bills</h1>
            <p className="text-gray-500 text-sm">Record bill payments and debt recoveries</p>
          </div>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-5 py-3 bg-green-600 text-white rounded-xl font-medium hover:bg-green-700 transition shadow">
            <span className="text-lg">+</span> Record Payment
          </button>
        </div>

        {/* Search */}
        <SearchBox value={search} onChange={setSearch} placeholder="Search payments by payer or reference…" />

        {/* Date Range Filter */}
        <DateRangeFilter range={range} setRange={setRange}
          customFrom={customFrom} setCustomFrom={setCustomFrom}
          customTo={customTo} setCustomTo={setCustomTo} />

        {/* Totals Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-gradient-to-br from-green-600 to-green-700 text-white rounded-2xl p-4 shadow col-span-2 lg:col-span-1">
            <p className="text-green-100 text-xs font-medium">Total Received</p>
            <p className="text-2xl font-bold mt-1">{formatCurrency(totalReceived)}</p>
            <p className="text-green-200 text-xs mt-1">{filtered.length} payment{filtered.length !== 1 ? 's' : ''}</p>
          </div>
          {PAYMENT_METHODS.map((pm) => {
            const total = filtered.filter((p) => p.paymentMethod === pm.value).reduce((s, p) => s + p.amountPaid, 0)
            return (
              <div key={pm.value} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <p className="text-xs font-semibold text-gray-500 mb-1">{pm.label}</p>
                <p className="text-lg font-bold text-gray-800">{formatCurrency(total)}</p>
              </div>
            )
          })}
        </div>

        {showForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-5">Record Payment</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Link to Signed Bill (Optional)</label>
                  <div className="relative">
                    <input type="text" value={linkQuery}
                      onChange={(e) => { setLinkQuery(e.target.value); setLinkOpen(true); if (!e.target.value) setForm((f) => ({ ...f, signedBillId: '' })) }}
                      onFocus={() => setLinkOpen(true)}
                      onBlur={() => setTimeout(() => setLinkOpen(false), 150)}
                      placeholder="Search by name, date or category (admin, customer…)"
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                    {linkOpen && (
                      <div className="absolute z-30 mt-1 w-full bg-white border-2 border-gray-200 rounded-xl shadow-lg max-h-64 overflow-auto">
                        <button type="button" onClick={() => selectBill(null)} className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-sm text-gray-500 border-b border-gray-100">— None (no linked bill) —</button>
                        {linkFiltered.map((b) => (
                          <button type="button" key={b.id} onClick={() => selectBill(b)} className="block w-full text-left px-3 py-2 hover:bg-indigo-50 text-sm">
                            <span className="font-semibold text-gray-800">{b.date ? formatDate(b.date) : ''} · #{b.seq ?? '?'}</span>
                            <span className="text-gray-600"> — {b.personName} — {formatCurrency(b.amount)}</span>
                            <span className="text-xs text-indigo-600"> [{b.billType.replace('_', ' ')}]</span>
                          </button>
                        ))}
                        {linkFiltered.length === 0 && <div className="px-3 py-3 text-gray-400 text-sm">No matching unpaid bills</div>}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                </div>
              </div>

              {/* Payment Category — locked to the linked bill's category */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Payment Category
                  {selectedBillIds.length > 0 && <span className="ml-2 text-xs font-normal text-indigo-600">🔒 locked to linked bill ({form.payerCategory})</span>}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                  {PAY_CATEGORIES.map((c) => {
                    const locked = selectedBillIds.length > 0
                    const active = form.payerCategory === c.label
                    return (
                      <button key={c.label} type="button" disabled={locked}
                        onClick={() => { if (!locked) setForm({ ...form, payerCategory: c.label, categoryCode: c.type }) }}
                        className={`py-2.5 px-2 rounded-xl text-sm font-medium transition text-center ${active ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} ${locked && !active ? 'opacity-40 cursor-not-allowed' : ''}`}>
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Payer Name *</label>
                  <input type="text" list="payerOptions" value={form.payerName} onChange={(e) => applyPayer(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                    placeholder={form.payerCategory ? `Select / type a ${form.payerCategory} name` : 'Who is paying?'} required />
                  <datalist id="payerOptions">
                    {persons
                      .filter((p) => { const cat = PAY_CATEGORIES.find((c) => c.label === form.payerCategory); return !cat || p.type === cat.type })
                      .map((p) => <option key={p.id} value={p.name} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Amount Paid (TZS) *</label>
                  <MoneyInput value={form.amountPaid} onChange={(v) => setForm({ ...form, amountPaid: v })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-xl font-bold"
                    placeholder="0" required />
                </div>
              </div>

              <BillSelector bills={signedBills as BillLite[]} payerName={form.payerName} category={form.payerCategory}
                selectedIds={selectedBillIds}
                onChange={(ids, matching) => {
                  setSelectedBillIds(ids)
                  const sum = matching.filter((b) => ids.includes(b.id)).reduce((s, b) => s + b.amount, 0)
                  if (sum > 0) setForm((f) => ({ ...f, amountPaid: String(sum) }))
                }} />

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Payment Method *</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PAYMENT_METHODS.map((pm) => (
                    <button key={pm.value} type="button"
                      onClick={() => setForm({ ...form, paymentMethod: pm.value })}
                      className={`py-3 rounded-xl font-medium text-sm transition ${form.paymentMethod === pm.value ? 'bg-indigo-600 text-white shadow-lg' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
                      {pm.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Outlet</label>
                  <select value={form.outletId} onChange={(e) => setForm({ ...form, outletId: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none">
                    {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Bill Reference</label>
                  <input type="text" value={form.billRef} onChange={(e) => setForm({ ...form, billRef: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                    placeholder="REF-001 (optional)" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                  rows={2} placeholder="Additional notes..." />
              </div>

              <div className="flex gap-3">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-3 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 transition disabled:opacity-60">
                  {submitting ? 'Recording...' : 'Record Payment'}
                </button>
                <button type="button" onClick={() => setShowForm(false)}
                  className="px-6 py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">Payment Records</h2>
            <span className="text-sm text-gray-500">
              {RANGE_OPTIONS.find((r) => r.key === range)?.label} · Total <strong className="text-green-700">{formatCurrency(totalReceived)}</strong>
            </span>
          </div>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400">Loading...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Payer</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Applied To (Bill)</th>
                    <th className="px-4 py-3 font-semibold">Bill Person</th>
                    <th className="px-4 py-3 font-semibold">Amount Paid</th>
                    <th className="px-4 py-3 font-semibold">Method</th>
                    <th className="px-4 py-3 font-semibold">Outlet</th>
                    <th className="px-4 py-3 font-semibold">By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((p) => {
                    const pm = PAYMENT_METHODS.find((m) => m.value === p.paymentMethod)
                    return (
                      <tr key={p.id} onClick={() => openStory(p)} title="Click for the full payment story"
                        className="hover:bg-indigo-50/60 cursor-pointer">
                        <td className="px-4 py-3 text-gray-600">{formatDate(p.date)}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{p.payerName}</td>
                        <td className="px-4 py-3 text-gray-600">{p.payerCategory || '-'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {p.signedBill
                            ? `${p.signedBill.date ? formatDate(p.signedBill.date) + ' · ' : ''}${formatCurrency(p.signedBill.amount)}`
                            : <span className="text-amber-600">credit (unlinked)</span>}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{p.signedBill?.personName || '-'}</td>
                        <td className="px-4 py-3 font-bold text-green-700">{formatCurrency(p.amountPaid)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${pm?.color || 'bg-gray-100 text-gray-700'}`}>
                            {pm?.label || p.paymentMethod}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">{p.outlet.name}</td>
                        <td className="px-4 py-3 text-gray-500">{p.cashier.name}</td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr><td colSpan={9} className="text-center py-12 text-gray-400">No payments in this period</td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="font-bold text-gray-900">
                      <td className="px-4 py-3" colSpan={5}>TOTAL ({filtered.length})</td>
                      <td className="px-4 py-3 text-green-700">{formatCurrency(totalReceived)}</td>
                      <td className="px-4 py-3" colSpan={3}></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Payment Story modal */}
      {storyOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={() => setStoryOpen(false)}>
          <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100 sticky top-0 bg-white">
              <h3 className="font-bold text-gray-900">📖 Payment Story</h3>
              <button onClick={() => setStoryOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
            </div>

            <div className="p-4 space-y-4">
              {storyLoading && <div className="py-10 text-center text-gray-400">Loading…</div>}

              {/* Unlinked credit payment */}
              {!storyLoading && creditOnly && (
                <div className="space-y-3">
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <p className="text-sm font-semibold text-amber-800">Recorded as credit — not linked to any bill</p>
                    <p className="text-xs text-amber-600 mt-1">This payment was not applied to a specific signed bill (e.g. an overpayment or advance).</p>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-4 space-y-1 text-sm">
                    <div className="flex justify-between"><span className="text-gray-500">Payer</span><span className="font-semibold">{creditOnly.payerName}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Category</span><span>{creditOnly.payerCategory || '-'}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Date</span><span>{formatDate(creditOnly.date)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Method</span><span>{creditOnly.paymentMethod}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">Recorded by</span><span>{creditOnly.cashier.name}</span></div>
                    <div className="flex justify-between border-t border-gray-100 pt-1 mt-1"><span className="font-semibold text-gray-700">Amount</span><span className="font-bold text-green-700">{formatCurrency(creditOnly.amountPaid)}</span></div>
                  </div>
                </div>
              )}

              {/* Linked bill story */}
              {!storyLoading && story && (
                <div className="space-y-4">
                  {/* The signed bill */}
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-indigo-700 uppercase">{story.bill.billType.replace('_', ' ')} bill</span>
                      <span className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${story.bill.status === 'PAID' ? 'bg-green-100 text-green-700' : story.bill.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{story.bill.status}</span>
                    </div>
                    <p className="text-lg font-bold text-gray-900 mt-1">{story.bill.personName}</p>
                    <p className="text-sm text-gray-600">Signed on <strong>{formatDate(story.bill.date)}</strong> · {formatCurrency(story.bill.amount)}</p>
                    {story.bill.serviceStaff && <p className="text-xs text-gray-500 mt-1">Served by {story.bill.serviceStaff}{story.bill.outlet?.name ? ` · ${story.bill.outlet.name}` : ''}</p>}
                    {story.bill.description && <p className="text-xs text-gray-400 mt-1 italic">{story.bill.description}</p>}
                  </div>

                  {/* Payment timeline */}
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-2">Payments ({story.payments.length})</p>
                    {story.payments.length === 0 ? (
                      <p className="text-sm text-gray-400">No payments recorded yet.</p>
                    ) : (
                      <ol className="space-y-2">
                        {(() => { let rem = story.bill.amount; return story.payments.map((pay) => { rem -= pay.amountPaid; return (
                          <li key={pay.id} className="flex items-start gap-3">
                            <span className="mt-1 w-2 h-2 rounded-full bg-green-500 shrink-0" />
                            <div className="flex-1 text-sm">
                              <div className="flex justify-between">
                                <span className="font-medium text-gray-800">{formatDate(pay.date)} — {pay.payerName}</span>
                                <span className="font-bold text-green-700">{formatCurrency(pay.amountPaid)}</span>
                              </div>
                              <p className="text-xs text-gray-500">{pay.paymentMethod}{pay.cashier?.name ? ` · recorded by ${pay.cashier.name}` : ''} · remaining {formatCurrency(Math.max(0, rem))}</p>
                            </div>
                          </li>
                        ) }) })()}
                      </ol>
                    )}
                  </div>

                  {/* Balance summary */}
                  <div className={`rounded-xl p-4 flex items-center justify-between ${story.balance <= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                    <div>
                      <p className={`font-semibold ${story.balance <= 0 ? 'text-green-800' : 'text-red-800'}`}>{story.balance <= 0 ? '✅ Fully settled' : '🔴 Outstanding balance'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Paid {formatCurrency(story.totalPaid)} of {formatCurrency(story.bill.amount)}</p>
                    </div>
                    <span className={`text-2xl font-bold ${story.balance <= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(Math.max(0, story.balance))}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  )
}
