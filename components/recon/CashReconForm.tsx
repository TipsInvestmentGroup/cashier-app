'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useApi } from '@/hooks/useApi'
import { MoneyInput } from '@/components/MoneyInput'
import { formatCurrency, getCurrencyCode } from '@/lib/utils'
import { EXCESS_REASONS } from '@/lib/excess-reasons'
import toast from 'react-hot-toast'

interface ExcessItem { key: string; id?: string; amount: string; reason: string; staffId: string; personId: string; paidAmount: number }

/** Inline Cash Reconciliation form (date + outlet fixed by the caller). */
export function CashReconForm({ outletId, date, onSaved }: { outletId: string; date: string; onSaved: () => void }) {
  const { request } = useApi()
  const [computed, setComputed] = useState({ cashCollected: 0, paidBillsCash: 0, cashExpenses: 0 })
  const [autoOpening, setAutoOpening] = useState(0)
  const [canVerify, setCanVerify] = useState(false)
  const [cashDeposited, setCashDeposited] = useState('')
  const [excessItems, setExcessItems] = useState<ExcessItem[]>([])
  const [staffList, setStaffList] = useState<{ id: string; name: string }[]>([])
  const [customerList, setCustomerList] = useState<{ id: string; name: string }[]>([])
  const [verifiedAmount, setVerifiedAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const excessKeyRef = useRef(0)
  const newExcessItem = (): ExcessItem => ({ key: `new-${excessKeyRef.current++}`, amount: '', reason: '', staffId: '', personId: '', paidAmount: 0 })

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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items = (res.existing.excessItems || []).map((it: any) => ({
          key: it.id, id: it.id, amount: String(it.amount), reason: it.reason, staffId: it.staffId || '', personId: it.personId || '',
          paidAmount: it.paidAmount || 0,
        }))
        setExcessItems(items)
        setNotes(res.existing.notes || '')
        if (res.existing.verifiedAmount != null) setVerifiedAmount(String(res.existing.verifiedAmount))
      } else {
        setExcessItems([])
      }
    } finally { setLoading(false) }
  }, [request, date, outletId])
  useEffect(() => { load() }, [load])

  const addExcessItem = () => setExcessItems((items) => [...items, newExcessItem()])
  const updateExcessItem = (key: string, patch: Partial<ExcessItem>) =>
    setExcessItems((items) => items.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  const removeExcessItem = (key: string) => {
    const it = excessItems.find((i) => i.key === key)
    if (it && it.paidAmount > 0) return toast.error('This excess item has recorded payments and cannot be removed — settle it from Excess Recon first.')
    setExcessItems((items) => items.filter((i) => i.key !== key))
  }

  const excess = excessItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)
  const closing = autoOpening + computed.cashCollected + computed.paidBillsCash - computed.cashExpenses - (Number(cashDeposited) || 0) - excess
  const verified = verifiedAmount !== '' ? Number(verifiedAmount) || 0 : null
  const vVar = verified != null ? verified - closing : null

  const save = async () => {
    if (cashDeposited === '') return toast.error('Cash Deposited to Bank is required')
    const activeItems = excessItems.filter((it) => (Number(it.amount) || 0) > 0)
    for (const it of activeItems) {
      if (!it.reason) return toast.error('Select a reason for each excess amount paid')
      if (it.reason === 'STAFF_TIP' && !it.staffId) return toast.error('Select the staff name for the excess amount paid')
      if (it.reason === 'CUSTOMER_EXCESS' && !it.personId) return toast.error('Select the customer name for the excess amount paid')
    }
    if (canVerify && verifiedAmount === '') return toast.error('Cash Verified amount is required (officer)')
    setBusy(true)
    try {
      await request('/api/cash-recon', {
        method: 'POST',
        body: JSON.stringify({
          date, outletId, notes,
          cashDeposited: Number(cashDeposited) || 0,
          excessItems: activeItems.map((it) => ({
            id: it.id,
            amount: Number(it.amount) || 0,
            reason: it.reason,
            ...(it.reason === 'STAFF_TIP' ? { staffId: it.staffId } : {}),
            ...(it.reason === 'CUSTOMER_EXCESS' ? { personId: it.personId } : {}),
          })),
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
        <label className="block text-sm font-semibold text-gray-700 mb-1">Cash Deposited to Bank ({getCurrencyCode()}) *</label>
        <MoneyInput value={cashDeposited} onChange={setCashDeposited} className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-lg font-bold" placeholder="0" />
      </div>
      <div className="border-2 border-amber-100 bg-amber-50/40 rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-semibold text-gray-700">Excess Amount Paid ({getCurrencyCode()})</label>
          {excess > 0 && <span className="text-sm font-bold text-amber-800">Total: {formatCurrency(excess)}</span>}
        </div>
        {excessItems.map((it) => {
          const locked = it.paidAmount > 0
          return (
          <div key={it.key} className="bg-white border-2 border-gray-100 rounded-xl p-2.5 space-y-2">
            {locked && (
              <p className="text-xs font-semibold text-indigo-600">🔒 {formatCurrency(it.paidAmount)} already settled — edit/removal locked. Manage payments from Excess Recon.</p>
            )}
            <div className="flex items-center gap-2">
              <MoneyInput value={it.amount} onChange={(v) => updateExcessItem(it.key, { amount: v })} disabled={locked}
                className="flex-1 px-3 py-2 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none font-bold disabled:bg-gray-50 disabled:text-gray-500" placeholder="0" />
              <button type="button" onClick={() => removeExcessItem(it.key)} title="Remove" disabled={locked}
                className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-100 disabled:opacity-40 disabled:hover:bg-red-50">✕</button>
            </div>
            {Number(it.amount) > 0 && (
              <>
                <select value={it.reason} onChange={(e) => updateExcessItem(it.key, { reason: e.target.value, staffId: '', personId: '' })} disabled={locked}
                  className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500">
                  <option value="">Select a reason…</option>
                  {EXCESS_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                {it.reason === 'STAFF_TIP' && (
                  <select value={it.staffId} onChange={(e) => updateExcessItem(it.key, { staffId: e.target.value })} disabled={locked}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500">
                    <option value="">Select staff…</option>
                    {staffList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
                {it.reason === 'CUSTOMER_EXCESS' && (
                  <select value={it.personId} onChange={(e) => updateExcessItem(it.key, { personId: e.target.value })} disabled={locked}
                    className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white disabled:bg-gray-50 disabled:text-gray-500">
                    <option value="">Select customer…</option>
                    {customerList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </>
            )}
          </div>
          )
        })}
        <button type="button" onClick={addExcessItem}
          className="w-full py-2 border-2 border-dashed border-amber-300 text-amber-700 rounded-xl text-sm font-semibold hover:bg-amber-50">
          + Add Excess Amount
        </button>
      </div>
      <div className="bg-indigo-50 rounded-xl p-3 flex items-center justify-between">
        <span className="font-semibold text-indigo-800">Closing Cash Balance</span>
        <span className={`text-xl font-bold ${closing < 0 ? 'text-red-700' : 'text-indigo-700'}`}>{formatCurrency(closing)}</span>
      </div>
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1">Cash Verified ({getCurrencyCode()}) {canVerify ? '*' : <span className="text-gray-400 font-normal">— officers only</span>}</label>
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
