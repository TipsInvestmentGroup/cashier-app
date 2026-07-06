'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'

interface Outlet { id: string; name: string }
interface Counter { code: string; label: string }
interface Warehouse { id: string; name: string }
interface Product { id: string; name: string; category: string | null }
interface StockRow { productId: string; quantity: number }

interface BreakageRow {
  id: string
  productName: string
  quantity: number
  reason: string
  unitCost: number
  valueLost: number
  note: string | null
  createdAt: string
}

const REASONS = ['BROKEN', 'EXPIRED', 'DAMAGED', 'LOST']
const REASON_LABEL: Record<string, string> = { BROKEN: 'Imevunjika', EXPIRED: 'Imepitwa na Wakati', DAMAGED: 'Imeharibika', LOST: 'Imepotea' }

export default function BreakagePage() {
  const { request } = useApi()

  const [locationMode, setLocationMode] = useState<'counter' | 'warehouse'>('counter')
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [counters, setCounters] = useState<Counter[]>([])
  const [outletId, setOutletId] = useState('')
  const [counterCode, setCounterCode] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [products, setProducts] = useState<Product[]>([])

  const [productId, setProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('BROKEN')
  const [note, setNote] = useState('')
  const [photoUrl, setPhotoUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const [history, setHistory] = useState<BreakageRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [stockRows, setStockRows] = useState<StockRow[]>([])

  useEffect(() => {
    request('/api/outlets').then(setOutlets).catch(() => {})
    request('/api/inventory/warehouses').then((d: { warehouses: Warehouse[] }) => setWarehouseId(d.warehouses[0]?.id ?? '')).catch(() => {})
    request('/api/pos/products').then((d: { flat: Product[] }) => setProducts(d.flat)).catch(() => {})
  }, [request])

  useEffect(() => {
    if (!outletId) { setCounters([]); setCounterCode(''); return }
    request(`/api/pos/counters?outletId=${outletId}`).then(setCounters).catch(() => {})
  }, [outletId, request])

  const locationReady = locationMode === 'warehouse' ? !!warehouseId : !!(outletId && counterCode)

  const loadIdRef = useRef(0)
  const loadHistory = useCallback(async () => {
    if (!locationReady) { setHistory([]); return }
    const id = ++loadIdRef.current
    setHistoryLoading(true)
    try {
      const qs = locationMode === 'warehouse' ? new URLSearchParams({ warehouseId }) : new URLSearchParams({ outletId, counterCode })
      const data = await request(`/api/inventory/breakage?${qs}`)
      if (id !== loadIdRef.current) return
      setHistory(data.rows ?? [])
    } catch {
      if (id !== loadIdRef.current) return
      setHistory([])
    }
    if (id === loadIdRef.current) setHistoryLoading(false)
  }, [locationMode, locationReady, warehouseId, outletId, counterCode, request, loadIdRef])

  useEffect(() => { loadHistory() }, [loadHistory])

  // Current stock at the selected location — lets the form show "Available:
  // N" and restrict the product picker to things actually stocked here,
  // instead of letting a user report breakage against a product with 0 (or
  // untracked) stock and only finding out from a server error afterward.
  useEffect(() => {
    if (!locationReady) { setStockRows([]); return }
    const url = locationMode === 'warehouse' ? `/api/inventory/warehouse-stock?warehouseId=${warehouseId}` : `/api/inventory/stock-levels?outletId=${outletId}&counterCode=${counterCode}`
    request(url).then((d: { rows: StockRow[] }) => setStockRows(d.rows ?? [])).catch(() => setStockRows([]))
    setProductId('')
  }, [locationMode, locationReady, warehouseId, outletId, counterCode, request])

  const stockByProduct = useMemo(() => new Map(stockRows.map((r) => [r.productId, r.quantity])), [stockRows])
  const trackedProducts = useMemo(() => products.filter((p) => (stockByProduct.get(p.id) ?? 0) > 0), [products, stockByProduct])
  const availableForSelected = productId ? stockByProduct.get(productId) ?? 0 : null

  const submitBreakage = async () => {
    if (!locationReady) { alert('Chagua eneo kwanza.'); return }
    if (!productId) { alert('Chagua bidhaa.'); return }
    const qty = parseFloat(quantity)
    if (isNaN(qty) || qty <= 0) { alert('Weka idadi sahihi.'); return }
    if (availableForSelected !== null && qty > availableForSelected) {
      alert(`Idadi uliyoweka (${qty}) ni zaidi ya iliyopo (${availableForSelected}).`); return
    }
    setBusy(true)
    try {
      await request('/api/inventory/breakage', {
        method: 'POST',
        body: JSON.stringify({
          productId, quantity: qty, reason,
          ...(locationMode === 'warehouse' ? { warehouseId } : { outletId, counterCode }),
          note: note.trim() || undefined, photoUrl: photoUrl.trim() || undefined,
        }),
      })
      setProductId(''); setQuantity(''); setNote(''); setPhotoUrl(''); setReason('BROKEN')
      await loadHistory()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Imeshindikana kuripoti')
    }
    setBusy(false)
  }

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-indigo-900 mb-4">Breakage</h1>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4">
          <div className="flex gap-2 mb-3">
            <button onClick={() => setLocationMode('counter')} className={`flex-1 text-xs font-semibold py-2 rounded-lg border-2 ${locationMode === 'counter' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-500'}`}>Counter</button>
            <button onClick={() => setLocationMode('warehouse')} className={`flex-1 text-xs font-semibold py-2 rounded-lg border-2 ${locationMode === 'warehouse' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-500'}`}>Main Store</button>
          </div>
          {locationMode === 'counter' && (
            <div className="flex flex-wrap gap-2 mb-3">
              <select value={outletId} onChange={(e) => setOutletId(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
                <option value="">-- Chagua Outlet --</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <select value={counterCode} onChange={(e) => setCounterCode(e.target.value)} disabled={!outletId} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none disabled:bg-gray-50">
                <option value="">-- Chagua Counter --</option>
                {counters.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
          )}

          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-1 focus:outline-none focus:border-indigo-400">
            <option value="">-- Chagua bidhaa --</option>
            {trackedProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {availableForSelected !== null && <div className="text-xs text-gray-400 mb-2">Iliyopo: {availableForSelected.toLocaleString()}</div>}
          {locationReady && trackedProducts.length === 0 && <div className="text-xs text-gray-400 mb-2">Hakuna bidhaa zenye stock hapa.</div>}

          <div className="grid grid-cols-2 gap-2 mb-3">
            <input type="text" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/[^\d.]/g, ''))} placeholder="Idadi" className="border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400" />
            <select value={reason} onChange={(e) => setReason(e.target.value)} className="border-2 border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-indigo-400">
              {REASONS.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          </div>

          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Maelezo (hiari)" className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:outline-none focus:border-indigo-400" />
          <input type="text" value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="Kiungo cha picha (hiari)" className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-indigo-400" />

          <button onClick={submitBreakage} disabled={busy} className="w-full bg-rose-600 text-white py-3 rounded-xl font-bold hover:bg-rose-700 disabled:opacity-50">
            {busy ? '...' : 'Ripoti Breakage'}
          </button>
        </div>

        {!locationReady ? null : historyLoading ? (
          <div className="text-center py-8 text-gray-400">Inapakia...</div>
        ) : history.length === 0 ? (
          <div className="text-center py-8 text-gray-400">Hakuna breakage bado.</div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Tarehe</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Bidhaa</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Idadi</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Sababu</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Thamani</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-4 py-2.5 text-xs text-gray-400">{new Date(b.createdAt).toLocaleString('sw-TZ')}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{b.productName}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{b.quantity.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-gray-600">{REASON_LABEL[b.reason] ?? b.reason}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-rose-600">{b.valueLost.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  )
}
