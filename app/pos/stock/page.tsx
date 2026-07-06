'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'

interface Outlet { id: string; name: string }
interface Counter { code: string; label: string }
interface Product { id: string; name: string; category: string | null }

interface StockRow {
  id: string
  productId: string
  productName: string
  category: string | null
  counterCode: string
  quantity: number
  trackingMode: string
  gramsPerServing: number | null
  updatedAt: string
}

interface LedgerRow {
  id: string
  type: string
  quantity: number
  balanceAfter: number
  note: string | null
  createdAt: string
}

const TYPE_PILL: Record<string, string> = {
  RESTOCK: 'bg-green-100 text-green-700',
  SALE: 'bg-amber-100 text-amber-700',
  ADJUSTMENT: 'bg-blue-100 text-blue-700',
}

export default function StockPage() {
  const { request } = useApi()

  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [counters, setCounters] = useState<Counter[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [outletId, setOutletId] = useState('')
  const [counterCode, setCounterCode] = useState('')

  const [rows, setRows] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [restockRow, setRestockRow] = useState<StockRow | null>(null) // null = closed, or a placeholder for "new product"
  const [showAddNew, setShowAddNew] = useState(false)
  const [restockProductId, setRestockProductId] = useState('')
  const [restockQty, setRestockQty] = useState('')
  const [restockNote, setRestockNote] = useState('')
  const [restockBusy, setRestockBusy] = useState(false)

  const [historyFor, setHistoryFor] = useState<StockRow | null>(null)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)

  useEffect(() => {
    request('/api/outlets').then(setOutlets).catch(() => {})
    request('/api/pos/products').then((data: { flat: Product[] }) => setProducts(data.flat)).catch(() => {})
  }, [request])

  useEffect(() => {
    if (!outletId) { setCounters([]); setCounterCode(''); return }
    request(`/api/pos/counters?outletId=${outletId}`).then(setCounters).catch(() => {})
  }, [outletId, request])

  const loadIdRef = useRef(0)
  const load = useCallback(async () => {
    if (!outletId) { setRows([]); return }
    const id = ++loadIdRef.current
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ outletId, ...(counterCode ? { counterCode } : {}) })
      const data = await request(`/api/inventory/stock-levels?${qs}`)
      if (id !== loadIdRef.current) return
      setRows(data.rows ?? [])
    } catch (err) {
      if (id !== loadIdRef.current) return
      setError(err instanceof Error ? err.message : 'Imeshindikana kupakia stock')
      setRows([])
    }
    if (id === loadIdRef.current) setLoading(false)
  }, [outletId, counterCode, request, loadIdRef])

  useEffect(() => { load() }, [load])

  const openRestock = (row: StockRow | null) => {
    setRestockRow(row)
    setRestockProductId(row?.productId ?? '')
    setRestockQty('')
    setRestockNote('')
    setShowAddNew(!row)
  }

  const submitRestock = async () => {
    if (!outletId || !counterCode) { alert('Chagua outlet na counter kwanza.'); return }
    const productId = restockRow?.productId ?? restockProductId
    if (!productId) { alert('Chagua bidhaa.'); return }
    const qty = parseFloat(restockQty)
    if (isNaN(qty) || qty <= 0) { alert('Weka idadi sahihi.'); return }
    setRestockBusy(true)
    try {
      await request('/api/inventory/stock-levels/restock', {
        method: 'POST',
        body: JSON.stringify({ productId, outletId, counterCode, quantity: qty, note: restockNote.trim() || undefined }),
      })
      setRestockRow(null)
      setShowAddNew(false)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Imeshindikana kuongeza stock')
    }
    setRestockBusy(false)
  }

  const openHistory = async (row: StockRow) => {
    setHistoryFor(row)
    setLedgerLoading(true)
    try {
      const qs = new URLSearchParams({ outletId, counterCode: row.counterCode, productId: row.productId })
      const data = await request(`/api/inventory/stock-levels/ledger?${qs}`)
      setLedger(data.rows ?? [])
    } catch {
      setLedger([])
    }
    setLedgerLoading(false)
  }

  const trackedProductIds = useMemo(() => new Set(rows.map((r) => r.productId)), [rows])
  const untracked = useMemo(() => products.filter((p) => !trackedProductIds.has(p.id)), [products, trackedProductIds])

  const activeCounterLabel = counters.find((c) => c.code === counterCode)?.label

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h1 className="text-xl font-bold text-indigo-900">Counter Stock</h1>
          {counterCode && (
            <button
              onClick={() => openRestock(null)}
              className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors"
            >
              + Ongeza Stock
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

        {!outletId ? (
          <div className="text-center py-16 text-gray-400">Chagua outlet na counter kuanza.</div>
        ) : !counterCode ? (
          <div className="text-center py-16 text-gray-400">Chagua counter.</div>
        ) : loading ? (
          <div className="text-center py-16 text-gray-400">Inapakia...</div>
        ) : error ? (
          <div className="text-center py-16 text-rose-500">{error}</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-2">📦</div>
            <p className="text-gray-500 font-medium">Hakuna bidhaa zinazofuatiliwa kwenye {activeCounterLabel} bado.</p>
            <button onClick={() => openRestock(null)} className="mt-3 text-indigo-600 text-sm font-medium">+ Ongeza bidhaa ya kwanza →</button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Bidhaa</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Category</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Kiasi</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Ilisasishwa</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.productName}</td>
                    <td className="px-4 py-2.5 text-gray-500">{r.category ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={r.quantity <= 0 ? 'text-rose-600 font-bold' : 'font-semibold text-gray-800'}>
                        {r.quantity.toLocaleString()}{r.trackingMode === 'WEIGHT' ? 'g' : ''}
                      </span>
                      {r.trackingMode === 'WEIGHT' && r.gramsPerServing ? (
                        <div className="text-xs text-gray-400">≈ {(r.quantity / r.gramsPerServing).toFixed(1)} servings</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{new Date(r.updatedAt).toLocaleString('sw-TZ')}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <button onClick={() => openHistory(r)} className="text-xs text-indigo-600 hover:underline mr-3">Historia</button>
                      <button onClick={() => openRestock(r)} className="text-xs font-semibold text-white bg-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-700">+ Ongeza</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Restock modal */}
        {(restockRow !== null || showAddNew) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { setRestockRow(null); setShowAddNew(false) }}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-gray-800 text-lg mb-1">Ongeza Stock</h3>
              <p className="text-sm text-gray-500 mb-4">{activeCounterLabel}</p>
              {restockRow ? (
                <p className="font-semibold text-gray-800 mb-3">{restockRow.productName}</p>
              ) : (
                <select value={restockProductId} onChange={(e) => setRestockProductId(e.target.value)} className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:outline-none focus:border-indigo-400" autoFocus>
                  <option value="">-- Chagua bidhaa --</option>
                  {untracked.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              <input
                type="text" inputMode="numeric" pattern="[0-9]*"
                value={restockQty}
                onChange={(e) => setRestockQty(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="Idadi (au gramu kwa shisha)"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-lg mb-3 focus:outline-none focus:border-indigo-400"
              />
              <input
                type="text" value={restockNote} onChange={(e) => setRestockNote(e.target.value)}
                placeholder="Maelezo (hiari)"
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-indigo-400"
              />
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { setRestockRow(null); setShowAddNew(false) }} className="border-2 border-gray-200 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50">Ghairi</button>
                <button onClick={submitRestock} disabled={restockBusy} className="bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50">
                  {restockBusy ? '...' : 'Weka'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* History modal */}
        {historyFor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setHistoryFor(null)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800 text-lg">{historyFor.productName}</h3>
                <button onClick={() => setHistoryFor(null)} className="text-gray-400 text-2xl leading-none">×</button>
              </div>
              {ledgerLoading ? (
                <div className="text-center py-8 text-gray-400">Inapakia...</div>
              ) : ledger.length === 0 ? (
                <div className="text-center py-8 text-gray-400">Hakuna historia bado.</div>
              ) : (
                <div className="space-y-2">
                  {ledger.map((entry) => (
                    <div key={entry.id} className="border border-gray-100 rounded-xl p-3 flex justify-between items-start">
                      <div>
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${TYPE_PILL[entry.type] ?? 'bg-gray-100 text-gray-600'}`}>{entry.type}</span>
                        {entry.note && <div className="text-xs text-gray-500 mt-1">{entry.note}</div>}
                        <div className="text-xs text-gray-400 mt-1">{new Date(entry.createdAt).toLocaleString('sw-TZ')}</div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold ${entry.quantity < 0 ? 'text-rose-600' : 'text-green-600'}`}>{entry.quantity > 0 ? '+' : ''}{entry.quantity.toLocaleString()}</div>
                        <div className="text-xs text-gray-400">bal. {entry.balanceAfter.toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
