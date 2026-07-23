'use client'
import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { MoneyInput } from '@/components/MoneyInput'
import { SearchBox } from '@/components/SearchBox'
import { formatCurrency, formatDate } from '@/lib/utils'
import { X, Trash2, MapPin, CalendarDays, History } from 'lucide-react'
import toast from 'react-hot-toast'

interface Opt { id: string; name: string }
interface ScopedPrice { outletId?: string; outletName?: string; eventId?: string; eventName?: string; sellingPrice: number }
interface ProductRow { id: string; name: string; code: string; sellingPrice: number; outletPrices: ScopedPrice[]; eventPrices: ScopedPrice[] }

/**
 * Product-centric pricing: for a single product, set different active
 * selling prices per outlet and/or per event without duplicating the
 * product. Each outlet/event can have at most one active override — enforced
 * server-side by the canonical scoped price list (see lib/pricing.ts
 * getOrCreateScopedList) — so e.g. Mikocheni=7,000 and Coco Beach=8,000 for
 * the same product just works, and sales at each outlet/event automatically
 * pick up the right price via the existing resolvePrices() engine.
 */
export function ProductPricingTab() {
  const { request } = useApi()
  const [rows, setRows] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ProductRow | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await request('/api/product-pricing'); setRows(r.rows || []) } catch { /* empty */ } finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const filtered = rows.filter((r) => !q || `${r.name} ${r.code}`.toLowerCase().includes(q))

  return (
    <div className="space-y-4">
      <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 text-sm text-indigo-800">
        Set different active prices for the same product per outlet or event — the base price below stays as the fallback. During sales, the price for the selected outlet/event applies automatically.
      </div>

      <SearchBox value={search} onChange={setSearch} placeholder="Search by product name or code…" />

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm"><EmptyState icon="🏷️" title="No products" hint="Create products under Setup → Products first." /></div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Product</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Base Price</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Outlet / Event Prices</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-2.5"><div className="font-medium text-gray-800">{r.name}</div><div className="text-[11px] text-gray-400 font-mono">{r.code}</div></td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{formatCurrency(r.sellingPrice)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {r.outletPrices.map((o) => (
                          <span key={`o-${o.outletId}`} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 rounded-lg px-2 py-0.5 text-xs font-medium"><MapPin className="w-3 h-3" />{o.outletName}: {formatCurrency(o.sellingPrice)}</span>
                        ))}
                        {r.eventPrices.map((e) => (
                          <span key={`e-${e.eventId}`} className="inline-flex items-center gap-1 bg-purple-50 text-purple-700 rounded-lg px-2 py-0.5 text-xs font-medium"><CalendarDays className="w-3 h-3" />{e.eventName}: {formatCurrency(e.sellingPrice)}</span>
                        ))}
                        {!r.outletPrices.length && !r.eventPrices.length && <span className="text-xs text-gray-400">Uses base price everywhere</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right"><button onClick={() => setEditing(r)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Manage prices</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editing && <ManagePricesModal product={editing} onClose={() => setEditing(null)} onChanged={load} />}
    </div>
  )
}

function ManagePricesModal({ product, onClose, onChanged }: { product: ProductRow; onClose: () => void; onChanged: () => void }) {
  const { request } = useApi()
  const confirm = useConfirm()
  const [outlets, setOutlets] = useState<Opt[]>([])
  const [events, setEvents] = useState<Opt[]>([])
  const [detail, setDetail] = useState<{ outletPrices: ScopedPrice[]; eventPrices: ScopedPrice[] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [addOutletId, setAddOutletId] = useState('')
  const [addOutletPrice, setAddOutletPrice] = useState('')
  const [addEventId, setAddEventId] = useState('')
  const [addEventPrice, setAddEventPrice] = useState('')
  const [history, setHistory] = useState<{ productName?: string; priceListName?: string; oldPrice?: number; newPrice: number; changedByName?: string; createdAt: string; action: string }[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await request(`/api/product-pricing?productId=${product.id}`); setDetail({ outletPrices: r.outletPrices || [], eventPrices: r.eventPrices || [] }) }
    catch { /* empty */ } finally { setLoading(false) }
  }, [request, product.id])
  useEffect(() => {
    load()
    request('/api/outlets').then((o: Opt[]) => setOutlets(o || [])).catch(() => {})
    request('/api/events').then((e: { rows?: Opt[] } | Opt[]) => setEvents(Array.isArray(e) ? e : (e.rows || []))).catch(() => {})
  }, [load, request])

  const setPrice = async (scope: 'OUTLET' | 'EVENT', refId: string, sellingPrice: number) => {
    try { await request('/api/product-pricing', { method: 'POST', body: JSON.stringify({ productId: product.id, scope, refId, sellingPrice }) }); load(); onChanged() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const removePrice = async (scope: 'OUTLET' | 'EVENT', refId: string) => {
    if (!(await confirm({ message: 'Remove this override? The base price will apply again.', danger: true, confirmLabel: 'Remove' }))) return
    try { await request(`/api/product-pricing?productId=${product.id}&scope=${scope}&refId=${refId}`, { method: 'DELETE' }); load(); onChanged() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const addOutlet = async () => {
    if (!addOutletId || addOutletPrice === '') return toast.error('Pick an outlet and a price.')
    await setPrice('OUTLET', addOutletId, Number(addOutletPrice)); setAddOutletId(''); setAddOutletPrice('')
  }
  const addEvent = async () => {
    if (!addEventId || addEventPrice === '') return toast.error('Pick an event and a price.')
    await setPrice('EVENT', addEventId, Number(addEventPrice)); setAddEventId(''); setAddEventPrice('')
  }
  const openHistory = async () => {
    try { const r = await request(`/api/price-lists/history?productId=${product.id}`); setHistory(r.rows || []) } catch { toast.error('Could not load history') }
  }

  const usedOutletIds = new Set((detail?.outletPrices || []).map((o) => o.outletId))
  const usedEventIds = new Set((detail?.eventPrices || []).map((e) => e.eventId))
  const availOutlets = outlets.filter((o) => !usedOutletIds.has(o.id))
  const availEvents = events.filter((e) => !usedEventIds.has(e.id))
  const inp = 'w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-gray-900">Prices — {product.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs text-gray-400 mb-4">Base price: <span className="font-semibold text-gray-600">{formatCurrency(product.sellingPrice)}</span> · edit on the Products page.</p>

        {loading ? <p className="text-sm text-gray-400">Loading…</p> : (
          <div className="space-y-5">
            {/* Outlet prices */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-blue-600" /> Outlet prices</h4>
              {detail?.outletPrices.length ? (
                <div className="space-y-1.5 mb-2">
                  {detail.outletPrices.map((o) => (
                    <div key={o.outletId} className="flex items-center justify-between bg-blue-50/50 rounded-lg px-3 py-1.5">
                      <span className="text-sm text-gray-700">{o.outletName}</span>
                      <div className="flex items-center gap-2">
                        <input type="number" defaultValue={o.sellingPrice} onBlur={(e) => { const v = Number(e.target.value); if (v !== o.sellingPrice && v >= 0) setPrice('OUTLET', o.outletId!, v) }} className="w-28 px-2 py-1 border-2 border-gray-200 rounded-lg text-sm text-right focus:border-indigo-500 focus:outline-none" />
                        <button onClick={() => removePrice('OUTLET', o.outletId!)} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-gray-400 mb-2">No outlet-specific price yet — the base price applies at every outlet.</p>}
              {availOutlets.length > 0 && (
                <div className="flex flex-wrap items-end gap-2 bg-gray-50 rounded-xl p-3">
                  <div className="flex-1 min-w-[160px]"><label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label>
                    <select value={addOutletId} onChange={(e) => setAddOutletId(e.target.value)} className={inp}><option value="">Select…</option>{availOutlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
                  <div className="w-32"><label className="block text-xs font-semibold text-gray-600 mb-1">Price (TZS)</label><MoneyInput value={addOutletPrice} onChange={setAddOutletPrice} className={inp} placeholder="0" /></div>
                  <Button size="sm" onClick={addOutlet}>Add</Button>
                </div>
              )}
            </div>

            {/* Event prices */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-purple-600" /> Event prices</h4>
              {detail?.eventPrices.length ? (
                <div className="space-y-1.5 mb-2">
                  {detail.eventPrices.map((e) => (
                    <div key={e.eventId} className="flex items-center justify-between bg-purple-50/50 rounded-lg px-3 py-1.5">
                      <span className="text-sm text-gray-700">{e.eventName}</span>
                      <div className="flex items-center gap-2">
                        <input type="number" defaultValue={e.sellingPrice} onBlur={(ev) => { const v = Number(ev.target.value); if (v !== e.sellingPrice && v >= 0) setPrice('EVENT', e.eventId!, v) }} className="w-28 px-2 py-1 border-2 border-gray-200 rounded-lg text-sm text-right focus:border-indigo-500 focus:outline-none" />
                        <button onClick={() => removePrice('EVENT', e.eventId!)} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-gray-400 mb-2">No event-specific price yet.</p>}
              {availEvents.length > 0 && (
                <div className="flex flex-wrap items-end gap-2 bg-gray-50 rounded-xl p-3">
                  <div className="flex-1 min-w-[160px]"><label className="block text-xs font-semibold text-gray-600 mb-1">Event</label>
                    <select value={addEventId} onChange={(e) => setAddEventId(e.target.value)} className={inp}><option value="">Select…</option>{availEvents.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
                  <div className="w-32"><label className="block text-xs font-semibold text-gray-600 mb-1">Price (TZS)</label><MoneyInput value={addEventPrice} onChange={setAddEventPrice} className={inp} placeholder="0" /></div>
                  <Button size="sm" onClick={addEvent}>Add</Button>
                </div>
              )}
            </div>

            <button onClick={openHistory} className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:underline"><History className="w-3.5 h-3.5" /> Price history</button>
            {history && (
              <div className="border-t border-gray-100 pt-3">
                {history.length === 0 ? <p className="text-sm text-gray-400">No changes recorded.</p> : (
                  <div className="max-h-52 overflow-y-auto text-sm space-y-1">
                    {history.map((h, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-xs border-b border-gray-50 py-1">
                        <span className="font-medium text-gray-700">{h.priceListName}</span>
                        <span className="text-gray-500">{h.oldPrice != null ? formatCurrency(h.oldPrice) : '—'} → {formatCurrency(h.newPrice)} <span className="text-gray-400">· {h.action} · {h.changedByName} · {formatDate(h.createdAt)}</span></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="mt-5"><Button variant="outline" className="w-full" onClick={onClose}>Close</Button></div>
      </div>
    </div>
  )
}
