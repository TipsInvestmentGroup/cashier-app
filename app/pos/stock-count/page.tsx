'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'

interface Outlet { id: string; name: string }
interface Counter { code: string; label: string }
interface Staff { id: string; name: string }

interface CountItem {
  id: string
  productId: string
  productName: string
  openingBalance: number
  receivings: number
  transfersIn: number
  closingSystem: number
  closingPhysical: number
  posSalesQty: number
  expectedSalesQty: number
  varianceQty: number
  unitCost: number
  varianceValue: number
  discountQty: number
  breakageQty: number
}

interface Attribution { id: string; staffName: string; amount: number; note: string | null }

interface SessionDetail {
  id: string
  outletId: string
  counterCode: string
  status: string
  totalLossValue: number
  countDate: string
  items: CountItem[]
  attributions: Attribution[]
}

interface SessionRow { id: string; counterCode: string; status: string; totalLossValue: number; countDate: string }

interface LineEdit { closingPhysical: string; discountQty: string; breakageQty: string }

export default function StockCountPage() {
  const { request } = useApi()

  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [counters, setCounters] = useState<Counter[]>([])
  const [outletId, setOutletId] = useState('')
  const [counterCode, setCounterCode] = useState('')

  const [history, setHistory] = useState<SessionRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const [session, setSession] = useState<SessionDetail | null>(null)
  const [edits, setEdits] = useState<Record<string, LineEdit>>({})
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const [staff, setStaff] = useState<Staff[]>([])
  const [attrStaffId, setAttrStaffId] = useState('')
  const [attrAmount, setAttrAmount] = useState('')
  const [attrNote, setAttrNote] = useState('')
  const [attrBusy, setAttrBusy] = useState(false)

  useEffect(() => {
    request('/api/outlets').then(setOutlets).catch(() => {})
  }, [request])

  useEffect(() => {
    if (!outletId) { setCounters([]); setCounterCode(''); return }
    request(`/api/pos/counters?outletId=${outletId}`).then(setCounters).catch(() => {})
    request(`/api/inventory/staff?outletId=${outletId}`).then((d: { staff: Staff[] }) => setStaff(d.staff)).catch(() => {})
  }, [outletId, request])

  const loadIdRef = useRef(0)
  const loadHistory = useCallback(async () => {
    if (!outletId || !counterCode) { setHistory([]); return }
    const id = ++loadIdRef.current
    setHistoryLoading(true)
    try {
      const qs = new URLSearchParams({ outletId, counterCode })
      const data = await request(`/api/inventory/stock-counts?${qs}`)
      if (id !== loadIdRef.current) return
      setHistory(data.rows ?? [])
    } catch {
      if (id !== loadIdRef.current) return
      setHistory([])
    }
    if (id === loadIdRef.current) setHistoryLoading(false)
  }, [outletId, counterCode, request, loadIdRef])

  useEffect(() => { loadHistory(); setSession(null) }, [loadHistory])

  const loadSession = async (id: string) => {
    const data = await request(`/api/inventory/stock-counts/${id}`)
    const s: SessionDetail = data.session
    setSession(s)
    setSubmitError('')
    const initialEdits: Record<string, LineEdit> = {}
    for (const item of s.items) {
      initialEdits[item.id] = {
        closingPhysical: item.closingPhysical ? String(item.closingPhysical) : '',
        discountQty: item.discountQty ? String(item.discountQty) : '',
        breakageQty: item.breakageQty ? String(item.breakageQty) : '',
      }
    }
    setEdits(initialEdits)
  }

  const startCount = async () => {
    if (!outletId || !counterCode) { alert('Chagua outlet na counter kwanza.'); return }
    setStarting(true)
    try {
      const data = await request('/api/inventory/stock-counts', { method: 'POST', body: JSON.stringify({ outletId, counterCode }) })
      await loadSession(data.sessionId)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Imeshindikana kuanza hesabu')
    }
    setStarting(false)
  }

  const computed = (item: CountItem) => {
    const edit = edits[item.id]
    const closingPhysical = parseFloat(edit?.closingPhysical || '') || 0
    const discountQty = parseFloat(edit?.discountQty || '') || 0
    const breakageQty = parseFloat(edit?.breakageQty || '') || 0
    const expectedSalesQty = item.closingSystem - closingPhysical
    const varianceQty = item.posSalesQty - expectedSalesQty
    const varianceValue = (varianceQty - discountQty - breakageQty) * item.unitCost
    return { expectedSalesQty, varianceQty, varianceValue }
  }

  const submitCount = async () => {
    if (!session) return
    const items = session.items.map((item) => {
      const edit = edits[item.id]
      return {
        id: item.id,
        closingPhysical: parseFloat(edit?.closingPhysical || '') || 0,
        discountQty: parseFloat(edit?.discountQty || '') || 0,
        breakageQty: parseFloat(edit?.breakageQty || '') || 0,
      }
    })
    setSubmitting(true)
    setSubmitError('')
    try {
      await request(`/api/inventory/stock-counts/${session.id}`, { method: 'PATCH', body: JSON.stringify({ items }) })
      await loadSession(session.id)
      await loadHistory()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Imeshindikana kuwasilisha')
    }
    setSubmitting(false)
  }

  const addAttribution = async () => {
    if (!session) return
    if (!attrStaffId) { alert('Chagua mfanyakazi.'); return }
    const amount = parseFloat(attrAmount)
    if (isNaN(amount) || amount <= 0) { alert('Weka kiasi sahihi.'); return }
    setAttrBusy(true)
    try {
      await request(`/api/inventory/stock-counts/${session.id}/attributions`, {
        method: 'POST', body: JSON.stringify({ staffId: attrStaffId, amount, note: attrNote.trim() || undefined }),
      })
      setAttrStaffId(''); setAttrAmount(''); setAttrNote('')
      await loadSession(session.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Imeshindikana kuongeza')
    }
    setAttrBusy(false)
  }

  const activeCounterLabel = counters.find((c) => c.code === counterCode)?.label

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h1 className="text-xl font-bold text-indigo-900">Stock Count</h1>
          {counterCode && !session && (
            <button onClick={startCount} disabled={starting} className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50">
              {starting ? '...' : 'Anza Hesabu ya Leo'}
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap gap-2 mb-4">
          <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
            <option value="">-- Chagua Outlet --</option>
            {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={counterCode} onChange={(e) => setCounterCode(e.target.value)} disabled={!outletId} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-50">
            <option value="">-- Chagua Counter --</option>
            {counters.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </div>

        {!outletId || !counterCode ? (
          <div className="text-center py-16 text-gray-400">Chagua outlet na counter kuanza.</div>
        ) : session ? (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-3 py-2.5 text-left font-semibold text-gray-600">Bidhaa</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Opening</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Receivings</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Transfers In</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Closing (System)</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Closing (Physical)</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Discount</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Breakage</th>
                    <th className="px-3 py-2.5 text-right font-semibold text-gray-600">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {session.items.map((item) => {
                    const c = computed(item)
                    const readOnly = session.status === 'SUBMITTED'
                    return (
                      <tr key={item.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-3 py-2 font-medium text-gray-800 whitespace-nowrap">{item.productName}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{item.openingBalance.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{item.receivings.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{item.transfersIn.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{item.closingSystem.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">
                          {readOnly ? item.closingPhysical.toLocaleString() : (
                            <input type="text" inputMode="decimal" value={edits[item.id]?.closingPhysical ?? ''} onChange={(e) => setEdits((cur) => ({ ...cur, [item.id]: { ...cur[item.id], closingPhysical: e.target.value.replace(/[^\d.]/g, '') } }))} className="w-20 border-2 border-gray-200 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:border-indigo-400" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {readOnly ? item.discountQty.toLocaleString() : (
                            <input type="text" inputMode="decimal" value={edits[item.id]?.discountQty ?? ''} onChange={(e) => setEdits((cur) => ({ ...cur, [item.id]: { ...cur[item.id], discountQty: e.target.value.replace(/[^\d.]/g, '') } }))} className="w-16 border-2 border-gray-200 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:border-indigo-400" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {readOnly ? item.breakageQty.toLocaleString() : (
                            <input type="text" inputMode="decimal" value={edits[item.id]?.breakageQty ?? ''} onChange={(e) => setEdits((cur) => ({ ...cur, [item.id]: { ...cur[item.id], breakageQty: e.target.value.replace(/[^\d.]/g, '') } }))} className="w-16 border-2 border-gray-200 rounded-lg px-2 py-1 text-right text-sm focus:outline-none focus:border-indigo-400" />
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right font-semibold ${(readOnly ? item.varianceValue : c.varianceValue) < 0 ? 'text-rose-600' : 'text-green-600'}`}>
                          {(readOnly ? item.varianceValue : c.varianceValue).toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {submitError && <div className="text-sm text-rose-600">{submitError}</div>}

            {session.status === 'IN_PROGRESS' ? (
              <button onClick={submitCount} disabled={submitting} className="bg-indigo-600 text-white text-sm font-bold px-6 py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                {submitting ? '...' : 'Wasilisha'}
              </button>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <div className="flex justify-between items-center mb-3">
                  <div className="font-bold text-gray-800">Total Loss Value</div>
                  <div className={`font-bold text-lg ${session.totalLossValue > 0 ? 'text-rose-600' : 'text-green-600'}`}>{session.totalLossValue.toLocaleString()}</div>
                </div>

                {session.attributions.length > 0 && (
                  <div className="space-y-1 mb-3">
                    {session.attributions.map((a) => (
                      <div key={a.id} className="flex justify-between text-sm text-gray-600">
                        <span>{a.staffName}{a.note ? ` — ${a.note}` : ''}</span>
                        <span className="font-semibold">{a.amount.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}

                {session.totalLossValue > 0 && (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="text-xs font-semibold text-gray-500 mb-2">Ongeza mfanyakazi aliyehusika</div>
                    <div className="flex flex-wrap gap-2">
                      <select value={attrStaffId} onChange={(e) => setAttrStaffId(e.target.value)} className="border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
                        <option value="">-- Mfanyakazi --</option>
                        {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      <input type="text" inputMode="decimal" value={attrAmount} onChange={(e) => setAttrAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Kiasi" className="w-24 border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                      <input type="text" value={attrNote} onChange={(e) => setAttrNote(e.target.value)} placeholder="Maelezo (hiari)" className="flex-1 min-w-[120px] border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                      <button onClick={addAttribution} disabled={attrBusy} className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">Ongeza</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {historyLoading ? (
              <div className="text-center py-8 text-gray-400">Inapakia...</div>
            ) : history.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-2">🧮</div>
                <p className="text-gray-500 font-medium">Hakuna hesabu ya {activeCounterLabel} bado.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Tarehe</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Status</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Loss Value</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700">{new Date(h.countDate).toLocaleDateString('sw-TZ')}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${h.status === 'SUBMITTED' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{h.status.replace('_', ' ')}</span>
                        </td>
                        <td className={`px-4 py-2.5 text-right font-semibold ${h.totalLossValue > 0 ? 'text-rose-600' : 'text-gray-500'}`}>{h.totalLossValue.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right"><button onClick={() => loadSession(h.id)} className="text-xs text-indigo-600 hover:underline">Fungua</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {session && (
          <button onClick={() => setSession(null)} className="mt-4 text-sm text-gray-500 hover:underline">← Rudi kwenye historia</button>
        )}
      </div>
    </AppShell>
  )
}
