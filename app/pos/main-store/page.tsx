'use client'
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'

interface Warehouse { id: string; name: string }
interface Outlet { id: string; name: string }
interface Counter { code: string; label: string }
interface Product { id: string; name: string; category: string | null }

interface StockRow {
  id: string
  productId: string
  productName: string
  category: string | null
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

interface GrnRow {
  id: string
  grnNumber: string
  supplierName: string
  invoiceRef: string | null
  itemCount: number
  totalPieces: number
  createdAt: string
}

interface TransferRow {
  id: string
  transferNumber: string
  outletName: string
  counterCode: string
  itemCount: number
  totalQuantity: number
  createdAt: string
}

const TYPE_PILL: Record<string, string> = {
  RESTOCK: 'bg-green-100 text-green-700',
  SALE: 'bg-amber-100 text-amber-700',
  ADJUSTMENT: 'bg-blue-100 text-blue-700',
  GRN_RECEIVE: 'bg-emerald-100 text-emerald-700',
  TRANSFER_OUT: 'bg-orange-100 text-orange-700',
  TRANSFER_IN: 'bg-sky-100 text-sky-700',
}

interface GrnLine { productId: string; purchaseUnit: string; packSize: string; quantityOrdered: string }
interface TransferLine { productId: string; quantity: string }

const emptyGrnLine = (): GrnLine => ({ productId: '', purchaseUnit: 'Carton', packSize: '', quantityOrdered: '' })
const emptyTransferLine = (): TransferLine => ({ productId: '', quantity: '' })

export default function MainStorePage() {
  const { request } = useApi()

  const [warehouseId, setWarehouseId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [counters, setCounters] = useState<Counter[]>([])

  const [rows, setRows] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [historyFor, setHistoryFor] = useState<StockRow | null>(null)
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)

  const [showGrn, setShowGrn] = useState(false)
  const [supplierName, setSupplierName] = useState('')
  const [invoiceRef, setInvoiceRef] = useState('')
  const [grnNote, setGrnNote] = useState('')
  const [grnLines, setGrnLines] = useState<GrnLine[]>([emptyGrnLine()])
  const [grnBusy, setGrnBusy] = useState(false)
  const [showGrnHistory, setShowGrnHistory] = useState(false)
  const [grnHistory, setGrnHistory] = useState<GrnRow[]>([])
  const [grnHistoryLoading, setGrnHistoryLoading] = useState(false)

  const [showTransfer, setShowTransfer] = useState(false)
  const [transferOutletId, setTransferOutletId] = useState('')
  const [transferCounterCode, setTransferCounterCode] = useState('')
  const [transferNote, setTransferNote] = useState('')
  const [transferLines, setTransferLines] = useState<TransferLine[]>([emptyTransferLine()])
  const [transferBusy, setTransferBusy] = useState(false)
  const [showTransferHistory, setShowTransferHistory] = useState(false)
  const [transferHistory, setTransferHistory] = useState<TransferRow[]>([])
  const [transferHistoryLoading, setTransferHistoryLoading] = useState(false)

  useEffect(() => {
    request('/api/inventory/warehouses').then((data: { warehouses: Warehouse[] }) => {
      setWarehouseId(data.warehouses[0]?.id ?? '')
    }).catch(() => {})
    request('/api/outlets').then(setOutlets).catch(() => {})
    request('/api/pos/products').then((data: { flat: Product[] }) => setProducts(data.flat)).catch(() => {})
  }, [request])

  useEffect(() => {
    if (!transferOutletId) { setCounters([]); setTransferCounterCode(''); return }
    request(`/api/pos/counters?outletId=${transferOutletId}`).then(setCounters).catch(() => {})
  }, [transferOutletId, request])

  const loadIdRef = useRef(0)
  const load = useCallback(async () => {
    if (!warehouseId) { setRows([]); return }
    const id = ++loadIdRef.current
    setLoading(true)
    setError('')
    try {
      const data = await request(`/api/inventory/warehouse-stock?warehouseId=${warehouseId}`)
      if (id !== loadIdRef.current) return
      setRows(data.rows ?? [])
    } catch (err) {
      if (id !== loadIdRef.current) return
      setError(err instanceof Error ? err.message : 'Imeshindikana kupakia stock')
      setRows([])
    }
    if (id === loadIdRef.current) setLoading(false)
  }, [warehouseId, request, loadIdRef])

  useEffect(() => { load() }, [load])

  const stockByProduct = useMemo(() => new Map(rows.map((r) => [r.productId, r.quantity])), [rows])

  const openHistory = async (row: StockRow) => {
    setHistoryFor(row)
    setLedgerLoading(true)
    try {
      const qs = new URLSearchParams({ warehouseId, productId: row.productId })
      const data = await request(`/api/inventory/stock-levels/ledger?${qs}`)
      setLedger(data.rows ?? [])
    } catch {
      setLedger([])
    }
    setLedgerLoading(false)
  }

  const openGrn = () => {
    setSupplierName(''); setInvoiceRef(''); setGrnNote(''); setGrnLines([emptyGrnLine()])
    setShowGrn(true)
  }

  const submitGrn = async () => {
    if (!warehouseId) return
    if (!supplierName.trim()) { alert('Weka jina la muuzaji.'); return }
    const items = []
    for (const line of grnLines) {
      if (!line.productId) continue
      const packSize = parseFloat(line.packSize)
      const quantityOrdered = parseFloat(line.quantityOrdered)
      if (isNaN(packSize) || packSize <= 0 || isNaN(quantityOrdered) || quantityOrdered <= 0) {
        alert('Angalia idadi na pack size za kila bidhaa.'); return
      }
      items.push({ productId: line.productId, purchaseUnit: line.purchaseUnit.trim() || 'Piece', packSize, quantityOrdered })
    }
    if (items.length === 0) { alert('Ongeza bidhaa moja angalau.'); return }
    setGrnBusy(true)
    try {
      await request('/api/inventory/grn', {
        method: 'POST',
        body: JSON.stringify({ warehouseId, supplierName: supplierName.trim(), invoiceRef: invoiceRef.trim() || undefined, note: grnNote.trim() || undefined, items }),
      })
      setShowGrn(false)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Imeshindikana kupokea bidhaa')
    }
    setGrnBusy(false)
  }

  const openGrnHistory = async () => {
    setShowGrnHistory(true)
    setGrnHistoryLoading(true)
    try {
      const data = await request(`/api/inventory/grn?warehouseId=${warehouseId}`)
      setGrnHistory(data.rows ?? [])
    } catch {
      setGrnHistory([])
    }
    setGrnHistoryLoading(false)
  }

  const openTransfer = () => {
    setTransferOutletId(''); setTransferCounterCode(''); setTransferNote(''); setTransferLines([emptyTransferLine()])
    setShowTransfer(true)
  }

  const submitTransfer = async () => {
    if (!warehouseId) return
    if (!transferOutletId || !transferCounterCode) { alert('Chagua outlet na counter.'); return }
    const items = []
    for (const line of transferLines) {
      if (!line.productId) continue
      const quantity = parseFloat(line.quantity)
      if (isNaN(quantity) || quantity <= 0) { alert('Weka idadi sahihi kwa kila bidhaa.'); return }
      items.push({ productId: line.productId, quantity })
    }
    if (items.length === 0) { alert('Ongeza bidhaa moja angalau.'); return }
    setTransferBusy(true)
    try {
      await request('/api/inventory/transfers', {
        method: 'POST',
        body: JSON.stringify({ warehouseId, outletId: transferOutletId, counterCode: transferCounterCode, note: transferNote.trim() || undefined, items }),
      })
      setShowTransfer(false)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Imeshindikana kuhamisha bidhaa')
    }
    setTransferBusy(false)
  }

  const openTransferHistory = async () => {
    setShowTransferHistory(true)
    setTransferHistoryLoading(true)
    try {
      const data = await request(`/api/inventory/transfers?warehouseId=${warehouseId}`)
      setTransferHistory(data.rows ?? [])
    } catch {
      setTransferHistory([])
    }
    setTransferHistoryLoading(false)
  }

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h1 className="text-xl font-bold text-indigo-900">Main Store</h1>
          <div className="flex gap-2 flex-wrap">
            <button onClick={openGrnHistory} className="text-sm font-medium text-indigo-600 px-3 py-2 hover:underline">GRN Historia</button>
            <button onClick={openTransferHistory} className="text-sm font-medium text-indigo-600 px-3 py-2 hover:underline">Transfer Historia</button>
            <button onClick={openGrn} className="bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-emerald-700 transition-colors">+ Pokea Bidhaa (GRN)</button>
            <button onClick={openTransfer} className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors">+ Hamisha kwa Counter</button>
          </div>
        </div>

        {!warehouseId ? (
          <div className="text-center py-16 text-gray-400">Inapakia Main Store...</div>
        ) : loading ? (
          <div className="text-center py-16 text-gray-400">Inapakia...</div>
        ) : error ? (
          <div className="text-center py-16 text-rose-500">{error}</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-2">🏬</div>
            <p className="text-gray-500 font-medium">Hakuna bidhaa Main Store bado.</p>
            <button onClick={openGrn} className="mt-3 text-indigo-600 text-sm font-medium">+ Pokea bidhaa ya kwanza →</button>
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
                      <button onClick={() => openHistory(r)} className="text-xs text-indigo-600 hover:underline">Historia</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* GRN modal */}
        {showGrn && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowGrn(false)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-gray-800 text-lg mb-4">Pokea Bidhaa (GRN)</h3>
              <input type="text" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Jina la muuzaji" className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:outline-none focus:border-indigo-400" autoFocus />
              <input type="text" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="Invoice/DO namba (hiari)" className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:outline-none focus:border-indigo-400" />

              <div className="space-y-3 mb-3">
                {grnLines.map((line, idx) => {
                  const pieces = (parseFloat(line.packSize) || 0) * (parseFloat(line.quantityOrdered) || 0)
                  return (
                    <div key={idx} className="border border-gray-100 rounded-xl p-3">
                      <select value={line.productId} onChange={(e) => setGrnLines((ls) => ls.map((l, i) => i === idx ? { ...l, productId: e.target.value } : l))} className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:border-indigo-400">
                        <option value="">-- Chagua bidhaa --</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <div className="grid grid-cols-3 gap-2">
                        <input type="text" value={line.purchaseUnit} onChange={(e) => setGrnLines((ls) => ls.map((l, i) => i === idx ? { ...l, purchaseUnit: e.target.value } : l))} placeholder="Unit (Carton)" className="border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                        <input type="text" inputMode="decimal" value={line.packSize} onChange={(e) => setGrnLines((ls) => ls.map((l, i) => i === idx ? { ...l, packSize: e.target.value.replace(/[^\d.]/g, '') } : l))} placeholder="Pack size" className="border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                        <input type="text" inputMode="decimal" value={line.quantityOrdered} onChange={(e) => setGrnLines((ls) => ls.map((l, i) => i === idx ? { ...l, quantityOrdered: e.target.value.replace(/[^\d.]/g, '') } : l))} placeholder="Idadi" className="border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                      </div>
                      {pieces > 0 && <div className="text-xs text-gray-400 mt-1.5">= {pieces.toLocaleString()} pieces</div>}
                      {grnLines.length > 1 && (
                        <button onClick={() => setGrnLines((ls) => ls.filter((_, i) => i !== idx))} className="text-xs text-rose-500 mt-1.5">Ondoa</button>
                      )}
                    </div>
                  )
                })}
              </div>
              <button onClick={() => setGrnLines((ls) => [...ls, emptyGrnLine()])} className="text-sm text-indigo-600 font-medium mb-3">+ Ongeza Bidhaa</button>

              <input type="text" value={grnNote} onChange={(e) => setGrnNote(e.target.value)} placeholder="Maelezo (hiari)" className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-indigo-400" />

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setShowGrn(false)} className="border-2 border-gray-200 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50">Ghairi</button>
                <button onClick={submitGrn} disabled={grnBusy} className="bg-emerald-600 text-white py-3 rounded-xl font-bold hover:bg-emerald-700 disabled:opacity-50">
                  {grnBusy ? '...' : 'Hifadhi'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Transfer modal */}
        {showTransfer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowTransfer(false)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-gray-800 text-lg mb-4">Hamisha kwa Counter</h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <select value={transferOutletId} onChange={(e) => setTransferOutletId(e.target.value)} className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
                  <option value="">-- Outlet --</option>
                  {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <select value={transferCounterCode} onChange={(e) => setTransferCounterCode(e.target.value)} disabled={!transferOutletId} className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 disabled:bg-gray-50">
                  <option value="">-- Counter --</option>
                  {counters.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>

              <div className="space-y-3 mb-3">
                {transferLines.map((line, idx) => {
                  const available = line.productId ? (stockByProduct.get(line.productId) ?? 0) : null
                  return (
                    <div key={idx} className="border border-gray-100 rounded-xl p-3">
                      <select value={line.productId} onChange={(e) => setTransferLines((ls) => ls.map((l, i) => i === idx ? { ...l, productId: e.target.value } : l))} className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:border-indigo-400">
                        <option value="">-- Chagua bidhaa --</option>
                        {products.filter((p) => (stockByProduct.get(p.id) ?? 0) > 0).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      {available !== null && <div className="text-xs text-gray-400 mb-1.5">Available: {available.toLocaleString()}</div>}
                      <input type="text" inputMode="decimal" value={line.quantity} onChange={(e) => setTransferLines((ls) => ls.map((l, i) => i === idx ? { ...l, quantity: e.target.value.replace(/[^\d.]/g, '') } : l))} placeholder="Idadi" className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                      {transferLines.length > 1 && (
                        <button onClick={() => setTransferLines((ls) => ls.filter((_, i) => i !== idx))} className="text-xs text-rose-500 mt-1.5">Ondoa</button>
                      )}
                    </div>
                  )
                })}
              </div>
              <button onClick={() => setTransferLines((ls) => [...ls, emptyTransferLine()])} className="text-sm text-indigo-600 font-medium mb-3">+ Ongeza Bidhaa</button>

              <input type="text" value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="Maelezo (hiari)" className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-4 focus:outline-none focus:border-indigo-400" />

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setShowTransfer(false)} className="border-2 border-gray-200 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50">Ghairi</button>
                <button onClick={submitTransfer} disabled={transferBusy} className="bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50">
                  {transferBusy ? '...' : 'Hamisha'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stock history modal */}
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

        {/* GRN history modal */}
        {showGrnHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowGrnHistory(false)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800 text-lg">GRN Historia</h3>
                <button onClick={() => setShowGrnHistory(false)} className="text-gray-400 text-2xl leading-none">×</button>
              </div>
              {grnHistoryLoading ? (
                <div className="text-center py-8 text-gray-400">Inapakia...</div>
              ) : grnHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-400">Hakuna GRN bado.</div>
              ) : (
                <div className="space-y-2">
                  {grnHistory.map((g) => (
                    <div key={g.id} className="border border-gray-100 rounded-xl p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold text-gray-800 text-sm">{g.grnNumber}</div>
                          <div className="text-xs text-gray-500">{g.supplierName}{g.invoiceRef ? ` · ${g.invoiceRef}` : ''}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-600">+{g.totalPieces.toLocaleString()}</div>
                          <div className="text-xs text-gray-400">{g.itemCount} items</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{new Date(g.createdAt).toLocaleString('sw-TZ')}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Transfer history modal */}
        {showTransferHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowTransferHistory(false)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-gray-800 text-lg">Transfer Historia</h3>
                <button onClick={() => setShowTransferHistory(false)} className="text-gray-400 text-2xl leading-none">×</button>
              </div>
              {transferHistoryLoading ? (
                <div className="text-center py-8 text-gray-400">Inapakia...</div>
              ) : transferHistory.length === 0 ? (
                <div className="text-center py-8 text-gray-400">Hakuna transfer bado.</div>
              ) : (
                <div className="space-y-2">
                  {transferHistory.map((t) => (
                    <div key={t.id} className="border border-gray-100 rounded-xl p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold text-gray-800 text-sm">{t.transferNumber}</div>
                          <div className="text-xs text-gray-500">{t.outletName} · {t.counterCode}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-orange-600">-{t.totalQuantity.toLocaleString()}</div>
                          <div className="text-xs text-gray-400">{t.itemCount} items</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{new Date(t.createdAt).toLocaleString('sw-TZ')}</div>
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
