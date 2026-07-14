'use client'
import { useEffect, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

const MAX_RECEIPT = 2 * 1024 * 1024 // 2MB

export interface PayItem {
  id: string; purpose: string; requestedBy: string; department?: string; amount: number; paymentMethod?: string; pettyType?: string
}
export interface PayFund { id: string; name: string; balance: number }

/** Shared "process payment" modal for an approved, unpaid petty-cash request. */
export function PayModal({ item, funds, defaultPayer, onClose, onPaid }: {
  item: PayItem; funds: PayFund[]; defaultPayer: string; onClose: () => void; onPaid: () => void
}) {
  const { request } = useApi()
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ pettyType: item.pettyType || 'CASHIER', method: item.paymentMethod || 'CASH', payerName: defaultPayer, paidAt: today, fundId: funds[0]?.id || '', receiptUrl: '' })
  const [busy, setBusy] = useState(false)
  const [methods, setMethods] = useState<{ value: string; label: string }[]>([])

  useEffect(() => {
    request('/api/payment-channels')
      .then((chs: { code: string; label: string; isActive: boolean }[]) =>
        setMethods((chs || []).filter((c) => c.isActive).map((c) => ({ value: c.code, label: c.label }))))
      .catch(() => {})
  }, [request])

  const onReceipt = (file?: File) => {
    if (!file) return setForm((f) => ({ ...f, receiptUrl: '' }))
    if (file.size > MAX_RECEIPT) return toast.error('Receipt must be under 2MB')
    const reader = new FileReader()
    reader.onload = () => setForm((f) => ({ ...f, receiptUrl: String(reader.result || '') }))
    reader.readAsDataURL(file)
  }

  const submit = async () => {
    if (form.pettyType === 'ACCOUNTANT' && !form.fundId) return toast.error('Select an accountant fund')
    setBusy(true)
    try {
      await request(`/api/petty-cash/${item.id}/pay`, { method: 'POST', body: JSON.stringify(form) })
      toast.success('Payment recorded')
      onPaid()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Payment failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-md rounded-2xl shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900">💳 Process Payment</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-sm">
          <div className="font-semibold text-gray-800">{item.purpose}</div>
          <div className="text-gray-500">{item.requestedBy} · {item.department || '—'}</div>
          <div className="text-xl font-bold text-indigo-700 mt-1">{formatCurrency(item.amount)}</div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Pay from</label>
          <div className="grid grid-cols-2 gap-2">
            {[{ v: 'CASHIER', l: '🧾 Cashier drawer' }, { v: 'ACCOUNTANT', l: '🏦 Accountant fund' }].map((t) => (
              <button key={t.v} type="button" onClick={() => setForm({ ...form, pettyType: t.v })}
                className={`py-2 rounded-xl text-sm font-medium transition ${form.pettyType === t.v ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{t.l}</button>
            ))}
          </div>
        </div>

        {form.pettyType === 'ACCOUNTANT' && (
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Fund</label>
            <select value={form.fundId} onChange={(e) => setForm({ ...form, fundId: e.target.value })} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white">
              <option value="">Select fund…</option>
              {funds.map((f) => <option key={f.id} value={f.id}>{f.name} — {formatCurrency(f.balance)} available</option>)}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Method</label>
          <div className="grid grid-cols-4 gap-2">
            {methods.map((m) => (
              <button key={m.value} type="button" onClick={() => setForm({ ...form, method: m.value })}
                className={`py-2 rounded-xl text-xs font-medium transition ${form.method === m.value ? 'bg-indigo-600 text-white shadow' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{m.label}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Payer</label>
            <input value={form.payerName} onChange={(e) => setForm({ ...form, payerName: e.target.value })} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Date</label>
            <input type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1">Receipt <span className="text-gray-400 font-normal">(image/PDF, optional)</span></label>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => onReceipt(e.target.files?.[0])} className="w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-medium" />
          {form.receiptUrl && <p className="text-[11px] text-green-600 mt-1">✓ Receipt attached</p>}
        </div>

        <button onClick={submit} disabled={busy} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
          {busy ? 'Processing…' : `Pay ${formatCurrency(item.amount)}`}
        </button>
      </div>
    </div>
  )
}
