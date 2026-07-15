'use client'
import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { MoneyInput } from '@/components/MoneyInput'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

const EXCESS_REASONS = [
  { value: 'KITCHEN_SALES', label: 'Kitchen Sales' },
  { value: 'STAFF_TIP', label: 'Staff Tip' },
  { value: 'CUSTOMER_EXCESS', label: 'Customer Excess' },
  { value: 'OTHERS', label: 'Others' },
]

/** Inline Cash Reconciliation form (date + outlet fixed by the caller). */
export function CashReconForm({ outletId, date, onSaved }: { outletId: string; date: string; onSaved: () => void }) {
  const { request } = useApi()
  const [computed, setComputed] = useState({ cashCollected: 0, paidBillsCash: 0, cashExpenses: 0 })
  const [autoOpening, setAutoOpening] = useState(0)
  const [canVerify, setCanVerify] = useState(false)
  const [cashDeposited, setCashDeposited] = useState('')
  const [excessAmountPaid, setExcessAmountPaid] = useState('')
  const [excessReason, setExcessReason] = useState('')
  const [excessStaffId, setExcessStaffId] = useState('')
  const [excessPersonId, setExcessPersonId] = useState('')
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([])
  const [customerList, setCustomerList] = useState<{ id: string; name: string }[]>([])
  const [verifiedAmount, setVerifiedAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ date }); if (outletId) p.set('outletId', outletId)
      const [res, staff, persons] = await Promise.all([
        request(`/api/cash-recon?${p}`),
        request('/api/staff-list'),
        request('/api/persons?type=CUSTOMER'),
      ])
      setComputed(res.computed || { cashCollected: 0, paidBillsCash: 0, cashExpenses: 0 })
      setAutoOpening(res.autoOpening || 0); setCanVerify(!!res.canVerify)
      setStaffList(staff || []); setCustomerList(persons || [])
      if (res.existing) {
        setCashDeposited(String(res.existing.cashDeposited ?? ''))
        setExcessAmountPaid(res.existing.excessAmountPaid ? String(res.existing.excessAmountPaid) : '')
        setExcessReason(res.existing.excessReason || '')
        setExcessStaffId(res.existing.excessStaffId || '')
        setExcessPersonId(res.existing.excessPersonId || '')
        setNotes(res.existing.notes || '')
        if (res.existing.verifiedAmount != null) setVerifiedAmount(String(res.existing.verifiedAmount))
      }
    } finally { setLoading(false) }
  }, [request, date, outletId])
  useEffect(() => { load() }, [load])

  const excess = Number(excessAmountPaid) || 0
  const closing = autoOpening + computed.cashCollected + computed.paidBillsCash - computed.cashExpenses - (Number(cashDeposited) || 0) - excess
  const verified = verifiedAmount !== '' ? Number(verifiedAmount) || 0 : null
  const vVar = verified != null ? verified - closing : null

  const save = async () => {
    if (cashDeposited === '') return toast.error('Cash Deposited to Bank is required')
    if (excess > 0) {
      if (!excessReason) return toast.error('Select a reason for the excess amount paid')
      if (excessReason === 'STAFF_TIP' && !excessStaffId) return toast.error('Select the staff name for the excess amount paid')
      if (excessReason === 'CUSTOMER_EXCESS' && !excessPersonId) return toast.error('Select the customer name for the excess amount paid')
    }
    if (canVerify && verifiedAmount === '') return toast.error('Cash Verified amount is required (officer)')
    setBusy(true)
    try {
      await request('/api/cash-recon', {
        method: 'POST',
        body: JSON.stringify({
          date, outletId, notes,
          cashDeposited: Number(cashDeposited) || 0,
          excessAmountPaid: excess,
          ...(excess > 0 ? {
            excessReason,
            ...(excessReason === 'STAFF_TIP' ? { excessStaffId } : {}),
            ...(excessReason === 'CUSTOMER_EXCESS' ? { excessPersonId } : {}),
          } : {}),
          ...(canVerify && verifiedAmount !== '' ? { verifiedAmount: Number(verifiedAmount) || 0 } : {}),
        }),
      })
      toast.success('Cash reconciliation saved')
      onSaved()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Error saving') } finally { setBusy(false) }
  }

  if (loading) return <p className="py-6 text-center text-gray-400 text-sm">Loading…</p>
  return (
    <div className="space-y-3">
      <div className="bg-gray-50 rounded-xl p-3 space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-gray-600">💵 Cash collected from staff</span><span className="font-semibold">{formatCurrency(computed.cashCollected)}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">✅ Paid bills (cash)</span><span className="font-semibold">{formatCurrency(computed.paidBillsCash)}</span></div>
        <div className="flex justify-between"><span className="text-gray-600">🧾 Cash expenses (requests)</span><span className="font-semibold text-red-600">−{formatCurrency(computed.cashExpenses)}</span></div>
        <div className="flex justify-between border-t border-gray-200 pt-1"><span className="text-gray-600">Opening (auto)</span><span className="font-semibold">{formatCurrency(autoOpening)}</span></div>
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Cash Deposited to Bank (TZS) *</label>
        <MoneyInput value={cashDeposited} onChange={setCashDeposited} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" />
      </div>
      <div className="border-2 border-amber-100 bg-amber-50/40 rounded-xl p-3 space-y-2">
        <label className="block text-sm font-semibold text-gray-700">Excess Amount Paid (TZS)</label>
        <MoneyInput value={excessAmountPaid} onChange={setExcessAmountPaid} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold bg-white" placeholder="0" />
        {excess > 0 && (
          <>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Reason *</label>
              <select value={excessReason} onChange={(e) => { setExcessReason(e.target.value); setExcessStaffId(''); setExcessPersonId('') }}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                <option value="">Select a reason…</option>
                {EXCESS_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            {excessReason === 'STAFF_TIP' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Staff Name *</label>
                <select value={excessStaffId} onChange={(e) => setExcessStaffId(e.target.value)}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                  <option value="">Select staff…</option>
                  {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            {excessReason === 'CUSTOMER_EXCESS' && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Customer Name *</label>
                <select value={excessPersonId} onChange={(e) => setExcessPersonId(e.target.value)}
                  className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                  <option value="">Select customer…</option>
                  {customerList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </>
        )}
      </div>
      <div className="bg-indigo-50 rounded-xl p-3 flex items-center justify-between">
        <span className="font-semibold text-indigo-800">Closing Cash Balance</span>
        <span className={`text-xl font-bold ${closing < 0 ? 'text-red-700' : 'text-indigo-700'}`}>{formatCurrency(closing)}</span>
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Cash Verified (TZS) {canVerify ? '*' : <span className="text-gray-400 font-normal">— officers only</span>}</label>
        {canVerify
          ? <MoneyInput value={verifiedAmount} onChange={setVerifiedAmount} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Physical cash counted" />
          : <div className="w-full px-3 py-2.5 border-2 border-gray-100 rounded-xl bg-gray-50 text-gray-500">{verified != null ? formatCurrency(verified) : 'Not yet verified'}</div>}
      </div>
      {vVar != null && vVar !== 0 && (
        <div className={`rounded-xl p-3 border-2 ${vVar > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center justify-between">
            <span className={`font-semibold ${vVar > 0 ? 'text-green-800' : 'text-red-800'}`}>{vVar > 0 ? '🔺 Excess cash' : '🔻 Cash shortage'}</span>
            <span className={`text-lg font-bold ${vVar > 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(Math.abs(vVar))}</span>
          </div>
        </div>
      )}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="Any notes…" />
      </div>
      <button onClick={save} disabled={busy} className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition disabled:opacity-60">
        {busy ? 'Saving…' : 'Save & continue →'}
      </button>
    </div>
  )
}
