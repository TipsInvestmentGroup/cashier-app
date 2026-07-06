'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SectionTabs, MYPOS_TABS } from '@/components/Layout/SectionTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'

interface Supplier { id: string; name: string }
interface Outlet { id: string; name: string }
interface Product { id: string; name: string; category: string | null }

interface PoRow {
  id: string
  poNumber: string
  supplierName: string
  status: string
  itemCount: number
  total: number
  createdAt: string
  createdById: string
}

interface PoItem {
  id: string
  productName: string
  purchaseUnit: string
  packSize: number
  quantity: number
  unitPrice: number
  amount: number
  quantityReceived: number
}

interface PoDetail {
  id: string
  poNumber: string
  status: string
  subtotal: number
  vatAmount: number
  total: number
  paymentTerms: string | null
  notes: string | null
  createdById: string
  supplier: { name: string }
  items: PoItem[]
  grns: { id: string; grnNumber: string; receivedDate: string }[]
}

const STATUS_PILL: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  PENDING_APPROVAL: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-rose-100 text-rose-700',
  SENT: 'bg-sky-100 text-sky-700',
  PARTIALLY_RECEIVED: 'bg-blue-100 text-blue-700',
  FULLY_RECEIVED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-gray-200 text-gray-500',
}

interface Line { productId: string; purchaseUnit: string; packSize: string; quantity: string; unitPrice: string }
const emptyLine = (): Line => ({ productId: '', purchaseUnit: 'Carton', packSize: '', quantity: '', unitPrice: '' })

export default function PurchaseOrdersPage() {
  const { request } = useApi()
  const { user } = useAuth()

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [products, setProducts] = useState<Product[]>([])

  const [statusFilter, setStatusFilter] = useState('')
  const [rows, setRows] = useState<PoRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [showNew, setShowNew] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [newSupplierName, setNewSupplierName] = useState('')
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [selectedOutlets, setSelectedOutlets] = useState<string[]>([])
  const [expectedDate, setExpectedDate] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([emptyLine()])
  const [poBusy, setPoBusy] = useState(false)

  const [detailFor, setDetailFor] = useState<PoDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  useEffect(() => {
    request('/api/inventory/suppliers').then((data: { suppliers: Supplier[] }) => setSuppliers(data.suppliers)).catch(() => {})
    request('/api/outlets').then(setOutlets).catch(() => {})
    request('/api/pos/products').then((data: { flat: Product[] }) => setProducts(data.flat)).catch(() => {})
  }, [request])

  const loadIdRef = useRef(0)
  const load = useCallback(async () => {
    const id = ++loadIdRef.current
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams(statusFilter ? { status: statusFilter } : {})
      const data = await request(`/api/inventory/purchase-orders?${qs}`)
      if (id !== loadIdRef.current) return
      setRows(data.rows ?? [])
    } catch (err) {
      if (id !== loadIdRef.current) return
      setError(err instanceof Error ? err.message : 'Imeshindikana kupakia')
      setRows([])
    }
    if (id === loadIdRef.current) setLoading(false)
  }, [statusFilter, request, loadIdRef])

  useEffect(() => { load() }, [load])

  const openNew = () => {
    setSupplierId(''); setNewSupplierName(''); setShowNewSupplier(false)
    setSelectedOutlets([]); setExpectedDate(''); setPaymentTerms(''); setNotes(''); setLines([emptyLine()])
    setShowNew(true)
  }

  const createSupplier = async () => {
    if (!newSupplierName.trim()) return
    try {
      const data = await request('/api/inventory/suppliers', { method: 'POST', body: JSON.stringify({ name: newSupplierName.trim() }) })
      setSuppliers((s) => [...s, data.supplier].sort((a, b) => a.name.localeCompare(b.name)))
      setSupplierId(data.supplier.id)
      setShowNewSupplier(false)
      setNewSupplierName('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Imeshindikana kuongeza muuzaji')
    }
  }

  const lineAmounts = lines.map((l) => (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0))
  const subtotal = lineAmounts.reduce((s, a) => s + a, 0)
  const vatAmount = subtotal * 0.18
  const total = subtotal + vatAmount

  const submitPo = async () => {
    if (!supplierId) { alert('Chagua muuzaji.'); return }
    const items = []
    for (const l of lines) {
      if (!l.productId) continue
      const packSize = parseFloat(l.packSize)
      const quantity = parseFloat(l.quantity)
      const unitPrice = parseFloat(l.unitPrice)
      if (isNaN(packSize) || packSize <= 0 || isNaN(quantity) || quantity <= 0 || isNaN(unitPrice) || unitPrice < 0) {
        alert('Angalia idadi, pack size, na bei za kila bidhaa.'); return
      }
      items.push({ productId: l.productId, purchaseUnit: l.purchaseUnit.trim() || 'Piece', packSize, quantity, unitPrice })
    }
    if (items.length === 0) { alert('Ongeza bidhaa moja angalau.'); return }
    setPoBusy(true)
    try {
      await request('/api/inventory/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          supplierId, outletIds: selectedOutlets, expectedDate: expectedDate || undefined,
          paymentTerms: paymentTerms.trim() || undefined, notes: notes.trim() || undefined, items,
        }),
      })
      setShowNew(false)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Imeshindikana kuunda PO')
    }
    setPoBusy(false)
  }

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setDetailFor(null)
    try {
      const data = await request(`/api/inventory/purchase-orders/${id}`)
      setDetailFor(data.purchaseOrder)
    } catch {
      alert('Imeshindikana kupakia PO')
    }
    setDetailLoading(false)
  }

  const doAction = async (action: 'submit' | 'approve' | 'reject' | 'cancel') => {
    if (!detailFor) return
    if (action === 'reject' || action === 'cancel') {
      const reason = prompt(action === 'reject' ? 'Sababu ya kukataa (hiari):' : 'Sababu ya kughairi (hiari):') || undefined
      setActionBusy(true)
      try {
        await request(`/api/inventory/purchase-orders/${detailFor.id}`, { method: 'PATCH', body: JSON.stringify({ action, reason }) })
        await openDetail(detailFor.id)
        await load()
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Imeshindikana')
      }
      setActionBusy(false)
      return
    }
    setActionBusy(true)
    try {
      await request(`/api/inventory/purchase-orders/${detailFor.id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
      await openDetail(detailFor.id)
      await load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Imeshindikana')
    }
    setActionBusy(false)
  }

  return (
    <AppShell>
      <SectionTabs tabs={MYPOS_TABS} />
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h1 className="text-xl font-bold text-indigo-900">Purchase Orders</h1>
          <button onClick={openNew} className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors">+ PO Mpya</button>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-wrap gap-2 mb-4">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none">
            <option value="">-- Status zote --</option>
            {Object.keys(STATUS_PILL).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400">Inapakia...</div>
        ) : error ? (
          <div className="text-center py-16 text-rose-500">{error}</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-2">📋</div>
            <p className="text-gray-500 font-medium">Hakuna Purchase Order bado.</p>
            <button onClick={openNew} className="mt-3 text-indigo-600 text-sm font-medium">+ Tengeneza PO ya kwanza →</button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">PO</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Muuzaji</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Jumla</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Tarehe</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.poNumber}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.supplierName}</td>
                    <td className="px-4 py-2.5"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_PILL[r.status] ?? 'bg-gray-100 text-gray-600'}`}>{r.status.replace('_', ' ')}</span></td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-800">{r.total.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-400">{new Date(r.createdAt).toLocaleDateString('sw-TZ')}</td>
                    <td className="px-4 py-2.5 text-right"><button onClick={() => openDetail(r.id)} className="text-xs text-indigo-600 hover:underline">Fungua</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* New PO modal */}
        {showNew && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowNew(false)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-bold text-gray-800 text-lg mb-4">PO Mpya</h3>

              {!showNewSupplier ? (
                <div className="flex gap-2 mb-3">
                  <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
                    <option value="">-- Chagua muuzaji --</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button onClick={() => setShowNewSupplier(true)} className="text-sm text-indigo-600 font-medium whitespace-nowrap">+ Muuzaji</button>
                </div>
              ) : (
                <div className="flex gap-2 mb-3">
                  <input type="text" value={newSupplierName} onChange={(e) => setNewSupplierName(e.target.value)} placeholder="Jina la muuzaji mpya" className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" autoFocus />
                  <button onClick={createSupplier} className="bg-indigo-600 text-white text-sm font-semibold px-3 py-2 rounded-xl">Ongeza</button>
                  <button onClick={() => setShowNewSupplier(false)} className="text-sm text-gray-500 px-2">Ghairi</button>
                </div>
              )}

              <div className="mb-3">
                <div className="text-xs text-gray-500 mb-1">Outlet(s) (hiari)</div>
                <div className="flex flex-wrap gap-2">
                  {outlets.map((o) => (
                    <label key={o.id} className="flex items-center gap-1.5 text-sm border-2 border-gray-200 rounded-lg px-2.5 py-1.5">
                      <input type="checkbox" checked={selectedOutlets.includes(o.id)} onChange={(e) => setSelectedOutlets((cur) => e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id))} />
                      {o.name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-3">
                <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                <input type="text" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} placeholder="Masharti ya malipo" className="border-2 border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
              </div>

              <div className="space-y-3 mb-3">
                {lines.map((line, idx) => {
                  const amount = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitPrice) || 0)
                  return (
                    <div key={idx} className="border border-gray-100 rounded-xl p-3">
                      <select value={line.productId} onChange={(e) => setLines((ls) => ls.map((l, i) => i === idx ? { ...l, productId: e.target.value } : l))} className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:border-indigo-400">
                        <option value="">-- Chagua bidhaa --</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <div className="grid grid-cols-4 gap-2">
                        <input type="text" value={line.purchaseUnit} onChange={(e) => setLines((ls) => ls.map((l, i) => i === idx ? { ...l, purchaseUnit: e.target.value } : l))} placeholder="Unit" className="border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                        <input type="text" inputMode="decimal" value={line.packSize} onChange={(e) => setLines((ls) => ls.map((l, i) => i === idx ? { ...l, packSize: e.target.value.replace(/[^\d.]/g, '') } : l))} placeholder="Pack" className="border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                        <input type="text" inputMode="decimal" value={line.quantity} onChange={(e) => setLines((ls) => ls.map((l, i) => i === idx ? { ...l, quantity: e.target.value.replace(/[^\d.]/g, '') } : l))} placeholder="Idadi" className="border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                        <input type="text" inputMode="decimal" value={line.unitPrice} onChange={(e) => setLines((ls) => ls.map((l, i) => i === idx ? { ...l, unitPrice: e.target.value.replace(/[^\d.]/g, '') } : l))} placeholder="Bei" className="border-2 border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-indigo-400" />
                      </div>
                      {amount > 0 && <div className="text-xs text-gray-400 mt-1.5">= {amount.toLocaleString()}</div>}
                      {lines.length > 1 && (
                        <button onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="text-xs text-rose-500 mt-1.5">Ondoa</button>
                      )}
                    </div>
                  )
                })}
              </div>
              <button onClick={() => setLines((ls) => [...ls, emptyLine()])} className="text-sm text-indigo-600 font-medium mb-3">+ Ongeza Bidhaa</button>

              <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Maelezo (hiari)" className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm mb-3 focus:outline-none focus:border-indigo-400" />

              <div className="border-t border-gray-100 pt-3 mb-4 text-sm space-y-1">
                <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{subtotal.toLocaleString()}</span></div>
                <div className="flex justify-between text-gray-500"><span>VAT (18%)</span><span>{vatAmount.toLocaleString()}</span></div>
                <div className="flex justify-between font-bold text-gray-800"><span>Jumla</span><span>{total.toLocaleString()}</span></div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => setShowNew(false)} className="border-2 border-gray-200 text-gray-600 py-3 rounded-xl font-semibold hover:bg-gray-50">Ghairi</button>
                <button onClick={submitPo} disabled={poBusy} className="bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50">
                  {poBusy ? '...' : 'Hifadhi (Draft)'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Detail modal */}
        {(detailLoading || detailFor) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetailFor(null)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              {detailLoading || !detailFor ? (
                <div className="text-center py-8 text-gray-400">Inapakia...</div>
              ) : (
                <>
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-bold text-gray-800 text-lg">{detailFor.poNumber}</h3>
                    <button onClick={() => setDetailFor(null)} className="text-gray-400 text-2xl leading-none">×</button>
                  </div>
                  <div className="mb-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_PILL[detailFor.status] ?? 'bg-gray-100 text-gray-600'}`}>{detailFor.status.replace('_', ' ')}</span>
                    <span className="text-sm text-gray-500 ml-2">{detailFor.supplier.name}</span>
                  </div>

                  <div className="space-y-2 mb-3">
                    {detailFor.items.map((it) => (
                      <div key={it.id} className="border border-gray-100 rounded-xl p-3 flex justify-between items-start text-sm">
                        <div>
                          <div className="font-semibold text-gray-800">{it.productName}</div>
                          <div className="text-xs text-gray-500">{it.quantity} {it.purchaseUnit} × {it.unitPrice.toLocaleString()}</div>
                          <div className="text-xs text-gray-400">Imepokelewa: {it.quantityReceived} / {it.quantity} {it.purchaseUnit}</div>
                        </div>
                        <div className="font-semibold text-gray-800">{it.amount.toLocaleString()}</div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-gray-100 pt-3 mb-4 text-sm space-y-1">
                    <div className="flex justify-between text-gray-500"><span>Subtotal</span><span>{detailFor.subtotal.toLocaleString()}</span></div>
                    <div className="flex justify-between text-gray-500"><span>VAT</span><span>{detailFor.vatAmount.toLocaleString()}</span></div>
                    <div className="flex justify-between font-bold text-gray-800"><span>Jumla</span><span>{detailFor.total.toLocaleString()}</span></div>
                  </div>

                  {detailFor.grns.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-semibold text-gray-500 mb-1">GRN zilizopokea dhidi ya PO hii</div>
                      {detailFor.grns.map((g) => (
                        <div key={g.id} className="text-sm text-gray-600">{g.grnNumber} — {new Date(g.receivedDate).toLocaleDateString('sw-TZ')}</div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {detailFor.status === 'DRAFT' && (
                      <button onClick={() => doAction('submit')} disabled={actionBusy} className="bg-indigo-600 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">Wasilisha kwa idhini</button>
                    )}
                    {detailFor.status === 'PENDING_APPROVAL' && detailFor.createdById !== user?.id && (
                      <>
                        <button onClick={() => doAction('approve')} disabled={actionBusy} className="bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">Idhinisha</button>
                        <button onClick={() => doAction('reject')} disabled={actionBusy} className="bg-rose-600 text-white text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">Kataa</button>
                      </>
                    )}
                    {detailFor.status === 'PENDING_APPROVAL' && detailFor.createdById === user?.id && (
                      <div className="text-xs text-gray-400 italic">Huwezi kuidhinisha PO uliyounda mwenyewe.</div>
                    )}
                    {!['FULLY_RECEIVED', 'CANCELLED', 'REJECTED'].includes(detailFor.status) && (
                      <button onClick={() => doAction('cancel')} disabled={actionBusy} className="border-2 border-gray-200 text-gray-600 text-sm font-semibold px-4 py-2 rounded-xl disabled:opacity-50">Ghairi</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
