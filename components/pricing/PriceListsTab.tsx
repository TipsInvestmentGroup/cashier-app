'use client'
import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, X, Trash2, Upload, Download, History, Check, Ban, Settings2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

interface Opt { id: string; name: string }
interface Product { id: string; name: string; code: string }
interface ListRow { id: string; name: string; description?: string; currency: string; status: string; priority: number; isDefault: boolean; effectiveFrom?: string; effectiveTo?: string; outletId?: string; eventId?: string; customerGroupId?: string; outlet?: { name: string }; event?: { name: string }; customerGroup?: { name: string }; _count?: { items: number } }
interface Item { id: string; productId: string; sellingPrice: number; product?: { name: string; code: string; buyingPrice: number; productCategory?: { label: string } | null } }

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-700 border-green-200',
  INACTIVE: 'bg-gray-100 text-gray-600 border-gray-200',
  PENDING_APPROVAL: 'bg-amber-50 text-amber-700 border-amber-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
}
const label = (s: string) => s.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export function PriceListsTab() {
  const { request } = useApi()
  const confirm = useConfirm()
  const [rows, setRows] = useState<ListRow[]>([])
  const [outlets, setOutlets] = useState<Opt[]>([])
  const [events, setEvents] = useState<Opt[]>([])
  const [groups, setGroups] = useState<Opt[]>([])
  const [loading, setLoading] = useState(false)
  const [order, setOrder] = useState<string[]>([])
  const [hasDefault, setHasDefault] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [editItems, setEditItems] = useState<ListRow | null>(null)
  const [showOrder, setShowOrder] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, cfg] = await Promise.all([request('/api/price-lists'), request('/api/price-lists/config')])
      setRows(r.rows || []); setOrder(cfg.order || []); setHasDefault(cfg.hasDefault)
    } catch { /* empty */ } finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    request('/api/outlets').then((o: Opt[]) => setOutlets(o || [])).catch(() => {})
    request('/api/events').then((e: { rows?: Opt[] } | Opt[]) => setEvents(Array.isArray(e) ? e : (e.rows || []))).catch(() => {})
    request('/api/customer-groups').then((g: { rows: Opt[] }) => setGroups(g.rows || [])).catch(() => {})
  }, [request])

  const seedDefault = async () => {
    try { const r = await request('/api/price-lists/config', { method: 'POST' }); toast.success(`Default list ready (${r.seeded} products added).`); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const saveOrder = async (next: string[]) => {
    setOrder(next)
    try { await request('/api/price-lists/config', { method: 'PUT', body: JSON.stringify({ order: next }) }) } catch { toast.error('Could not save order') }
  }
  const act = async (id: string, action: string) => {
    let reason: string | undefined
    if (action === 'reject') { const r = window.prompt('Reason for rejecting?'); if (r === null) return; reason = r }
    try { await request(`/api/price-lists/${id}`, { method: 'PATCH', body: JSON.stringify({ action, reason }) }); toast.success(label(action) + 'd'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const del = async (r: ListRow) => {
    if (!(await confirm({ title: 'Delete price list?', message: `"${r.name}" and its ${r._count?.items || 0} prices will be removed.`, danger: true, confirmLabel: 'Delete' }))) return
    try { await request(`/api/price-lists/${r.id}`, { method: 'DELETE' }); toast.success('Deleted'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }

  const scopeText = (r: ListRow) => [r.event?.name && `Event: ${r.event.name}`, r.outlet?.name && `Outlet: ${r.outlet.name}`, r.customerGroup?.name && `Group: ${r.customerGroup.name}`].filter(Boolean).join(' · ') || (r.isDefault ? 'Default (all)' : 'All')

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" /> New price list</Button>
        <Button variant="outline" onClick={() => setShowOrder((s) => !s)}><Settings2 className="w-4 h-4 mr-1" /> Resolution order</Button>
        {!hasDefault && <Button variant="outline" onClick={seedDefault}><RefreshCw className="w-4 h-4 mr-1" /> Seed Default from products</Button>}
        {hasDefault && <Button variant="outline" onClick={seedDefault}><RefreshCw className="w-4 h-4 mr-1" /> Sync new products into Default</Button>}
      </div>

      {showOrder && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">Resolution priority (highest first)</p>
          <div className="flex flex-wrap items-center gap-2">
            {order.map((s, i) => (
              <div key={s} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 rounded-lg px-2 py-1 text-xs font-semibold">
                <span>{i + 1}. {label(s)}</span>
                {i > 0 && <button onClick={() => { const n = [...order];[n[i - 1], n[i]] = [n[i], n[i - 1]]; saveOrder(n) }} className="hover:text-indigo-900" title="Move up">↑</button>}
                {i < order.length - 1 && <button onClick={() => { const n = [...order];[n[i + 1], n[i]] = [n[i], n[i + 1]]; saveOrder(n) }} className="hover:text-indigo-900" title="Move down">↓</button>}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Default must stay last (the fallback tier). Changes save automatically.</p>
        </div>
      )}

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm"><EmptyState icon="🏷️" title="No price lists yet" hint="Seed the Default from your products, or create a scoped list for an outlet/event/customer group." /></div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Name</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Scope</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Effective</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Prices</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Priority</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Status</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5"><div className="font-medium text-gray-800">{r.name}{r.isDefault && <span className="ml-1.5 text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">DEFAULT</span>}</div>{r.description && <div className="text-[11px] text-gray-400">{r.description}</div>}</td>
                    <td className="px-4 py-2.5 text-gray-600">{scopeText(r)}</td>
                    <td className="px-4 py-2.5 text-gray-500 text-xs">{r.effectiveFrom ? formatDate(r.effectiveFrom) : '—'} → {r.effectiveTo ? formatDate(r.effectiveTo) : '∞'}</td>
                    <td className="px-4 py-2.5 text-right"><button onClick={() => setEditItems(r)} className="text-indigo-600 hover:underline font-medium">{r._count?.items ?? 0}</button></td>
                    <td className="px-4 py-2.5 text-right text-gray-600">{r.priority}</td>
                    <td className="px-4 py-2.5"><span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-semibold border ${STATUS_STYLE[r.status] || STATUS_STYLE.INACTIVE}`}>{label(r.status)}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => setEditItems(r)} className="px-2 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Prices</button>
                        {r.status === 'PENDING_APPROVAL' && <>
                          <button onClick={() => act(r.id, 'approve')} className="p-1.5 rounded-lg text-green-600 hover:bg-green-50" title="Approve"><Check className="w-4 h-4" /></button>
                          <button onClick={() => act(r.id, 'reject')} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50" title="Reject"><Ban className="w-4 h-4" /></button>
                        </>}
                        {!r.isDefault && <button onClick={() => del(r)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete"><Trash2 className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showNew && <NewListModal outlets={outlets} events={events} groups={groups} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load() }} />}
      {editItems && <ItemsModal list={editItems} onClose={() => setEditItems(null)} onChanged={load} />}
    </div>
  )
}

function NewListModal({ outlets, events, groups, onClose, onSaved }: { outlets: Opt[]; events: Opt[]; groups: Opt[]; onClose: () => void; onSaved: () => void }) {
  const { request } = useApi()
  const [f, setF] = useState({ name: '', description: '', outletId: '', eventId: '', customerGroupId: '', currency: 'TZS', effectiveFrom: '', effectiveTo: '', priority: 0, status: 'ACTIVE' })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!f.name.trim()) return toast.error('Name is required.')
    setSaving(true)
    try { await request('/api/price-lists', { method: 'POST', body: JSON.stringify(f) }); toast.success('Price list created'); onSaved() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setSaving(false) }
  }
  const inp = 'w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none'
  return (
    <Modal title="New price list" onClose={onClose}>
      <div className="space-y-3">
        <div><label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label><input className={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. VIP Outlet Prices" /></div>
        <div><label className="block text-xs font-semibold text-gray-600 mb-1">Description</label><input className={inp} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Outlet</label><select className={inp} value={f.outletId} onChange={(e) => setF({ ...f, outletId: e.target.value })}><option value="">Any</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Event</label><select className={inp} value={f.eventId} onChange={(e) => setF({ ...f, eventId: e.target.value })}><option value="">Any</option>{events.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Customer group</label><select className={inp} value={f.customerGroupId} onChange={(e) => setF({ ...f, customerGroupId: e.target.value })}><option value="">Any</option>{groups.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Effective from</label><input type="date" className={inp} value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Effective to</label><input type="date" className={inp} value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} /></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Currency</label><input className={inp} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} /></div>
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Priority</label><input type="number" className={inp} value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })} /></div>
        </div>
        <p className="text-[11px] text-gray-400">A list with no outlet/event/group is a general list; leave blank scopes for “applies to all”. Priority breaks ties within the same scope tier.</p>
      </div>
      <div className="flex gap-2 mt-4"><Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button></div>
    </Modal>
  )
}

function ItemsModal({ list, onClose, onChanged }: { list: ListRow; onClose: () => void; onChanged: () => void }) {
  const { request } = useApi()
  const confirm = useConfirm()
  const [items, setItems] = useState<Item[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [addPid, setAddPid] = useState('')
  const [addPrice, setAddPrice] = useState('')
  const [history, setHistory] = useState<{ productName?: string; oldPrice?: number; newPrice: number; changedByName?: string; createdAt: string; action: string }[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await request(`/api/price-lists/${list.id}`); setItems(r.priceList?.items || []) } catch { /* empty */ } finally { setLoading(false) }
  }, [request, list.id])
  useEffect(() => { load(); request('/api/products').then((p: Product[]) => setProducts(p || [])).catch(() => {}) }, [load, request])

  const setPrice = async (productId: string, sellingPrice: number) => {
    try { await request(`/api/price-lists/${list.id}/items`, { method: 'POST', body: JSON.stringify({ productId, sellingPrice }) }); load(); onChanged() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const add = async () => {
    if (!addPid || addPrice === '') return toast.error('Pick a product and price.')
    await setPrice(addPid, Number(addPrice)); setAddPid(''); setAddPrice('')
  }
  const remove = async (productId: string) => {
    if (!(await confirm({ message: 'Remove this product from the list?', danger: true, confirmLabel: 'Remove' }))) return
    try { await request(`/api/price-lists/${list.id}/items?productId=${productId}`, { method: 'DELETE' }); load(); onChanged() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const exportXlsx = async () => {
    const XLSX = await import('xlsx')
    const aoa = [['Code', 'Product', 'Selling Price'], ...items.map((i) => [i.product?.code || '', i.product?.name || '', i.sellingPrice])]
    const ws = XLSX.utils.aoa_to_sheet(aoa); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Prices')
    XLSX.writeFile(wb, `${list.name.replace(/\W+/g, '_')}_prices.xlsx`)
  }
  const importXlsx = async (file: File) => {
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
      const header = (aoa[0] || []).map((c) => String(c).toLowerCase())
      const ci = header.findIndex((h) => h.includes('code')), ni = header.findIndex((h) => h.includes('product') || h.includes('name')), pi = header.findIndex((h) => h.includes('price'))
      if (pi < 0) return toast.error('Need a "Price" column.')
      const rows = aoa.slice(1).map((r) => ({ code: ci >= 0 ? String(r[ci] || '') : '', sellingPrice: Number(String(r[pi] ?? '').replace(/[, ]/g, '')) || 0 })).filter((r) => r.code)
      if (!rows.length) return toast.error('No rows with a product code found.')
      const res = await request(`/api/price-lists/${list.id}/items`, { method: 'PUT', body: JSON.stringify({ items: rows, mode: 'merge' }) })
      toast.success(`Imported: ${res.applied} updated, ${res.unmatched} unmatched.`); load(); onChanged()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Import failed') }
  }
  const openHistory = async () => {
    try { const r = await request(`/api/price-lists/history?priceListId=${list.id}`); setHistory(r.rows || []) } catch { toast.error('Could not load history') }
  }

  const inList = new Set(items.map((i) => i.productId))
  const available = products.filter((p) => !inList.has(p.id))

  return (
    <Modal title={`Prices — ${list.name}`} wide onClose={onClose}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Button variant="outline" size="sm" onClick={exportXlsx}><Download className="w-4 h-4 mr-1" /> Export</Button>
        <label className="inline-flex"><span className="inline-flex items-center px-3 py-1.5 rounded-xl border-2 border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50 cursor-pointer"><Upload className="w-4 h-4 mr-1" /> Import</span><input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importXlsx(f) }} /></label>
        <Button variant="outline" size="sm" onClick={openHistory}><History className="w-4 h-4 mr-1" /> Price history</Button>
      </div>

      {/* Add row */}
      <div className="flex flex-wrap items-end gap-2 mb-3 bg-gray-50 rounded-xl p-3">
        <div className="flex-1 min-w-[180px]"><label className="block text-xs font-semibold text-gray-600 mb-1">Add product</label>
          <select value={addPid} onChange={(e) => setAddPid(e.target.value)} className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none bg-white"><option value="">Select…</option>{available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <div className="w-32"><label className="block text-xs font-semibold text-gray-600 mb-1">Price</label><input type="number" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} className="w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none" /></div>
        <Button size="sm" onClick={add}><Plus className="w-4 h-4" /></Button>
      </div>

      {loading ? <p className="text-sm text-gray-400">Loading…</p> : items.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No prices yet. Add products above or import an Excel file.</p> : (
        <div className="border border-gray-100 rounded-xl overflow-hidden max-h-[50vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide sticky top-0"><tr><th className="px-3 py-2 text-left font-semibold">Product</th><th className="px-3 py-2 text-left font-semibold">Category</th><th className="px-3 py-2 text-right font-semibold">Cost</th><th className="px-3 py-2 text-right font-semibold">Selling</th><th className="px-3 py-2 text-right font-semibold">Margin</th><th></th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((i) => {
                const cost = i.product?.buyingPrice || 0; const margin = i.sellingPrice - cost
                return (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5 font-medium text-gray-800">{i.product?.name}</td>
                    <td className="px-3 py-1.5 text-gray-500">{i.product?.productCategory?.label || '—'}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500">{cost ? formatCurrency(cost) : '—'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <input type="number" defaultValue={i.sellingPrice} onBlur={(e) => { const v = Number(e.target.value); if (v !== i.sellingPrice) setPrice(i.productId, v) }}
                        className="w-24 px-2 py-1 border-2 border-gray-200 rounded-lg text-sm text-right focus:border-indigo-500 focus:outline-none" />
                    </td>
                    <td className={`px-3 py-1.5 text-right font-semibold ${margin < 0 ? 'text-red-600' : 'text-green-600'}`}>{cost ? formatCurrency(margin) : '—'}</td>
                    <td className="px-3 py-1.5 text-right"><button onClick={() => remove(i.productId)} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {history && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <div className="flex items-center justify-between mb-2"><h4 className="text-sm font-semibold text-gray-700">Price history</h4><button onClick={() => setHistory(null)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button></div>
          {history.length === 0 ? <p className="text-sm text-gray-400">No changes recorded.</p> : (
            <div className="max-h-52 overflow-y-auto text-sm space-y-1">
              {history.map((h, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-xs border-b border-gray-50 py-1">
                  <span className="font-medium text-gray-700">{h.productName}</span>
                  <span className="text-gray-500">{h.oldPrice != null ? formatCurrency(h.oldPrice) : '—'} → {formatCurrency(h.newPrice)} <span className="text-gray-400">· {h.action} · {h.changedByName} · {formatDate(h.createdAt)}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4"><Button variant="outline" className="w-full" onClick={onClose}>Close</Button></div>
    </Modal>
  )
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} p-6 max-h-[92vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-gray-900">{title}</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div>
        {children}
      </div>
    </div>
  )
}
