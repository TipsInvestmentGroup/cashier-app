'use client'
import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { MoneyInput } from '@/components/MoneyInput'
import { formatCurrency } from '@/lib/utils'
import toast from 'react-hot-toast'

type Entry = { opening: string; closing: string; verifiedOpening: string; verifiedClosing: string; reason: string }
const EMPTY: Entry = { opening: '', closing: '', verifiedOpening: '', verifiedClosing: '', reason: '' }

/** Inline Digital Payment Reconciliation form (per channel; date + outlet fixed by caller). */
export function DigitalReconForm({ outletId, date, onSaved }: { outletId: string; date: string; onSaved: () => void }) {
  const { request } = useApi()
  const [rows, setRows] = useState<{ code: string; label: string; reported: number }[]>([])
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [canVerify, setCanVerify] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ date }); if (outletId) p.set('outletId', outletId)
      const res = await request(`/api/bank-recon?${p}`)
      const rs = res.rows || []
      setRows(rs.map((r: { code: string; label: string; reported: number }) => ({ code: r.code, label: r.label, reported: r.reported })))
      setCanVerify(!!res.canVerify)
      const e: Record<string, Entry> = {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const r of rs as any[]) e[r.code] = {
        opening: r.openingBalance != null ? String(r.openingBalance) : '',
        closing: r.closingBalance != null ? String(r.closingBalance) : '',
        verifiedOpening: r.verifiedOpening != null ? String(r.verifiedOpening) : '',
        verifiedClosing: r.verifiedClosing != null ? String(r.verifiedClosing) : '',
        reason: r.reason || '',
      }
      setEntries(e)
    } finally { setLoading(false) }
  }, [request, date, outletId])
  useEffect(() => { load() }, [load])

  const upd = (code: string, patch: Partial<Entry>) => setEntries((m) => ({ ...m, [code]: { ...(m[code] || EMPTY), ...patch } }))

  const save = async () => {
    const missing = rows.filter((r) => {
      const e = entries[r.code] || EMPTY
      return canVerify ? (e.verifiedOpening === '' || e.verifiedClosing === '') : (e.opening === '' || e.closing === '')
    }).map((r) => r.label)
    if (missing.length) return toast.error(`Fill ${canVerify ? 'Verified Opening & Closing' : 'Opening & Closing'} for: ${missing.join(', ')}`)
    setBusy(true)
    try {
      const channels = rows.map((r) => {
        const e = entries[r.code] || EMPTY
        return { channel: r.code, openingBalance: e.opening, closingBalance: e.closing, reason: e.reason || '', ...(canVerify ? { verifiedOpening: e.verifiedOpening, verifiedClosing: e.verifiedClosing } : {}) }
      })
      await request('/api/bank-recon', { method: 'POST', body: JSON.stringify({ date, outletId, channels }) })
      toast.success('Digital payment reconciliation saved')
      onSaved()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Error saving') } finally { setBusy(false) }
  }

  if (loading) return <p className="py-6 text-center text-gray-400 text-sm">Loading…</p>
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm text-gray-400 py-2">No digital channels configured.</p>}
      {rows.map((r) => {
        const e = entries[r.code] || EMPTY
        const hasReq = e.opening !== '' || e.closing !== ''
        const required = (Number(e.closing) || 0) - (Number(e.opening) || 0)
        const variance = hasReq ? r.reported - required : null
        return (
          <div key={r.code} className="border border-gray-100 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-gray-800">{r.label}</span>
              <span className="text-xs text-gray-500">Reported: <strong className="text-gray-700">{formatCurrency(r.reported)}</strong></span>
            </div>
            {!canVerify ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-[11px] font-semibold text-gray-500 mb-0.5">Opening *</label><MoneyInput value={e.opening} onChange={(v) => upd(r.code, { opening: v })} className="w-full px-2 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="0" /></div>
                  <div><label className="block text-[11px] font-semibold text-gray-500 mb-0.5">Closing *</label><MoneyInput value={e.closing} onChange={(v) => upd(r.code, { closing: v })} className="w-full px-2 py-2 border-2 border-gray-200 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="0" /></div>
                </div>
                {variance != null && (
                  <div className={`flex items-center justify-between text-sm rounded-lg px-3 py-2 ${variance === 0 ? 'bg-green-50' : variance > 0 ? 'bg-amber-50' : 'bg-red-50'}`}>
                    <span className={`font-semibold ${variance === 0 ? 'text-green-800' : variance > 0 ? 'text-amber-800' : 'text-red-800'}`}>{variance === 0 ? '✅ Matches' : variance > 0 ? '🔺 Excess of' : '🔻 Loss of'}</span>
                    <span className={`font-bold ${variance === 0 ? 'text-green-700' : variance > 0 ? 'text-amber-700' : 'text-red-700'}`}>{formatCurrency(Math.abs(variance))}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-[11px] font-semibold text-indigo-600 mb-0.5">Verified opening *</label><MoneyInput value={e.verifiedOpening} onChange={(v) => upd(r.code, { verifiedOpening: v })} className="w-full px-2 py-2 border-2 border-indigo-100 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="0" /></div>
                <div><label className="block text-[11px] font-semibold text-indigo-600 mb-0.5">Verified closing *</label><MoneyInput value={e.verifiedClosing} onChange={(v) => upd(r.code, { verifiedClosing: v })} className="w-full px-2 py-2 border-2 border-indigo-100 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" placeholder="0" /></div>
              </div>
            )}
            {((canVerify) || (variance != null && variance !== 0)) && (
              <input value={e.reason} onChange={(ev) => upd(r.code, { reason: ev.target.value })} placeholder="Reason for variance…" className="w-full px-2 py-1.5 border-2 border-gray-100 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
            )}
          </div>
        )
      })}
      <button onClick={save} disabled={busy} className="w-full py-3 bg-sky-600 text-white font-bold rounded-xl hover:bg-sky-700 transition disabled:opacity-60">
        {busy ? 'Saving…' : 'Save & continue →'}
      </button>
    </div>
  )
}
