'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import { format } from 'date-fns'
import { DateRangeFilter } from '@/components/DateRangeFilter'
import { RangeKey, RANGE_OPTIONS, inRange } from '@/lib/dateRange'

interface PaidBill {
  id: string; date: string; payerName: string; amountPaid: number; paymentMethod: string
  outlet: { name: string }; cashier: { name: string }; notes?: string; billRef?: string
  signedBill?: { voucherNumber: string; amount: number; personName: string }
}
interface SignedBill { id: string; voucherNumber: string; personName: string; amount: number; billType: string; status: string }
interface Outlet { id: string; name: string }

const PAYMENT_METHODS = [
  { value: 'CASH', label: '💵 Cash', color: 'bg-green-100 text-green-800' },
  { value: 'CRDB', label: '🏦 CRDB', color: 'bg-blue-100 text-blue-800' },
  { value: 'STANBIC', label: '🏛️ Stanbic', color: 'bg-purple-100 text-purple-800' },
  { value: 'MPESA', label: '📱 M-PESA', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'PAYROLL', label: '🧾 Payroll', color: 'bg-indigo-100 text-indigo-800' },
]

export default function PaidBillsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [paidBills, setPaidBills] = useState<PaidBill[]>([])
  const [signedBills, setSignedBills] = useState<SignedBill[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [range, setRange] = useState<RangeKey>('month')
  const [customFrom, setCustomFrom] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [customTo, setCustomTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [form, setForm] = useState({
    signedBillId: '', payerName: '', amountPaid: '', paymentMethod: 'CASH',
    notes: '', outletId: user?.outlet?.id || '', date: format(new Date(), 'yyyy-MM-dd'), billRef: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    const [pb, sb, o] = await Promise.all([
      request('/api/paid-bills'),
      request('/api/signed-bills?status=UNPAID'),
      request('/api/outlets'),
    ])
    setPaidBills(pb)
    setSignedBills(sb.filter((b: SignedBill) => b.status !== 'PAID'))
    setOutlets(o)
    if (o.length && !form.outletId) setForm((f) => ({ ...f, outletId: user?.outlet?.id || o[0].id }))
    setLoading(false)
  }, [request, user])

  useEffect(() => { load() }, [load])

  const handleBillSelect = (billId: string) => {
    const bill = signedBills.find((b) => b.id === billId)
    setForm((f) => ({
      ...f, signedBillId: billId,
      payerName: bill?.personName || f.payerName,
      amountPaid: bill?.amount?.toString() || f.amountPaid,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.payerName) return toast.error('Payer name required')
    if (!form.amountPaid || Number(form.amountPaid) <= 0) return toast.error('Amount must be > 0')
    setSubmitting(true)
    try {
      await request('/api/paid-bills', {
        method: 'POST',
        body: JSON.stringify({ ...form, amountPaid: Number(form.amountPaid) }),
      })
      toast.success('Payment recorded successfully!')
      setForm({ signedBillId: '', payerName: '', amountPaid: '', paymentMethod: 'CASH', notes: '', outletId: form.outletId, date: format(new Date(), 'yyyy-MM-dd'), billRef: '' })
      setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error recording payment')
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = paidBills.filter((p) => inRange(p.date, range, customFrom, customTo))
  const totalReceived = filtered.reduce((s, p) => s + p.amountPaid, 0)

  return (
    <AppShell>
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
                  <select value={form.signedBillId} onChange={(e) => handleBillSelect(e.target.value)}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none">
                    <option value="">-- Select unpaid bill --</option>
                    {signedBills.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.voucherNumber} - {b.personName} - {formatCurrency(b.amount)} [{b.billType}]
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
                  <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Payer Name *</label>
                  <input type="text" value={form.payerName} onChange={(e) => setForm({ ...form, payerName: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none"
                    placeholder="Who is paying?" required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Amount Paid (TZS) *</label>
                  <input type="number" min="1" value={form.amountPaid} onChange={(e) => setForm({ ...form, amountPaid: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-xl font-bold"
                    placeholder="0" required />
                </div>
              </div>

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
                    <th className="px-4 py-3 font-semibold">Linked Bill</th>
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
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-600">{formatDate(p.date)}</td>
                        <td className="px-4 py-3 font-medium text-gray-800">{p.payerName}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                          {p.signedBill ? `${p.signedBill.voucherNumber}` : '-'}
                        </td>
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
                    <tr><td colSpan={7} className="text-center py-12 text-gray-400">No payments in this period</td></tr>
                  )}
                </tbody>
                {filtered.length > 0 && (
                  <tfoot className="bg-gray-50 border-t-2 border-gray-200">
                    <tr className="font-bold text-gray-900">
                      <td className="px-4 py-3" colSpan={3}>TOTAL ({filtered.length})</td>
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
    </AppShell>
  )
}
