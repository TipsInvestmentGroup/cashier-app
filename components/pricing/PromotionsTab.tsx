'use client'
import { useState, useEffect, useCallback } from 'react'
import { useApi } from '@/hooks/useApi'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Plus, Trash2, Pencil, X } from 'lucide-react'
import toast from 'react-hot-toast'

interface Opt { id: string; name: string }
interface Product { id: string; name: string }
interface Promo { id: string; name: string; type: string; value: number; outletId?: string; eventId?: string; customerGroupId?: string; productId?: string; categoryId?: string; buyQty?: number; getQty?: number; bundlePrice?: number; effectiveFrom?: string; effectiveTo?: string; status: string; priority: number; customerGroup?: { name: string } }

const TYPE_LABEL: Record<string, string> = { PERCENTAGE: '% off', FIXED: 'Fixed off', BUY_X_GET_Y: 'Buy X Get Y', BUNDLE: 'Bundle' }

export function PromotionsTab() {
  const { request } = useApi()
  const confirm = useConfirm()
  const [rows, setRows] = useState<Promo[]>([])
  const [outlets, setOutlets] = useState<Opt[]>([])
  const [groups, setGroups] = useState<Opt[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [edit, setEdit] = useState<Promo | null>(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await request('/api/promotions'); setRows(r.rows || []) } catch { /* empty */ } finally { setLoading(false) }
  }, [request])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    request('/api/outlets').then((o: Opt[]) => setOutlets(o || [])).catch(() => {})
    request('/api/customer-groups').then((g: { rows: Opt[] }) => setGroups(g.rows || [])).catch(() => {})
    request('/api/products').then((p: Product[]) => setProducts(p || [])).catch(() => {})
  }, [request])

  const del = async (p: Promo) => {
    if (!(await confirm({ title: 'Delete promotion?', message: `Delete "${p.name}"?`, danger: true, confirmLabel: 'Delete' }))) return
    try { await request(`/api/promotions/${p.id}`, { method: 'DELETE' }); toast.success('Deleted'); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const toggle = async (p: Promo) => {
    try { await request(`/api/promotions/${p.id}`, { method: 'PATCH', body: JSON.stringify({ status: p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }) }); load() }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') }
  }
  const valueText = (p: Promo) => p.type === 'PERCENTAGE' ? `${p.value}%` : p.type === 'FIXED' ? formatCurrency(p.value) : p.type === 'BUY_X_GET_Y' ? `Buy ${p.buyQty} get ${p.getQty}` : p.bundlePrice != null ? `Bundle @ ${formatCurrency(p.bundlePrice)}` : '—'

  return (
    <div className="space-y-4">
      <Button onClick={() => setShowNew(true)}><Plus className="w-4 h-4 mr-1" /> New promotion</Button>
      <p className="text-[11px] text-gray-400">Promotions are separate from price lists and apply <strong>after</strong> the selling price is resolved.</p>
      {loading ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm"><EmptyState icon="🎉" title="No promotions" hint="Add percentage/fixed discounts, Buy X Get Y, or bundle pricing." /></div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-[11px] uppercase tracking-wide"><tr><th className="px-4 py-2.5 text-left font-semibold">Name</th><th className="px-4 py-2.5 text-left font-semibold">Type</th><th className="px-4 py-2.5 text-left font-semibold">Value</th><th className="px-4 py-2.5 text-left font-semibold">Effective</th><th className="px-4 py-2.5 text-left font-semibold">Status</th><th className="px-4 py-2.5 text-right font-semibold">Actions</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{p.name}</td>
                  <td className="px-4 py-2.5 text-gray-600">{TYPE_LABEL[p.type] || p.type}</td>
                  <td className="px-4 py-2.5 text-gray-700 font-medium">{valueText(p)}</td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{p.effectiveFrom ? formatDate(p.effectiveFrom) : '—'} → {p.effectiveTo ? formatDate(p.effectiveTo) : '∞'}</td>
                  <td className="px-4 py-2.5"><button onClick={() => toggle(p)} className={`px-2 py-0.5 rounded-lg text-xs font-semibold ${p.status === 'ACTIVE' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.status === 'ACTIVE' ? 'Active' : 'Inactive'}</button></td>
                  <td className="px-4 py-2.5"><div className="flex items-center justify-end gap-1.5"><button onClick={() => setEdit(p)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"><Pencil className="w-4 h-4" /></button><button onClick={() => del(p)} className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="w-4 h-4" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(showNew || edit) && <PromoModal promo={edit} outlets={outlets} groups={groups} products={products} onClose={() => { setShowNew(false); setEdit(null) }} onSaved={() => { setShowNew(false); setEdit(null); load() }} />}
    </div>
  )
}

function PromoModal({ promo, outlets, groups, products, onClose, onSaved }: { promo: Promo | null; outlets: Opt[]; groups: Opt[]; products: Product[]; onClose: () => void; onSaved: () => void }) {
  const { request } = useApi()
  const [f, setF] = useState({
    name: promo?.name || '', type: promo?.type || 'PERCENTAGE', value: promo?.value ?? 0,
    outletId: promo?.outletId || '', customerGroupId: promo?.customerGroupId || '', productId: promo?.productId || '',
    buyQty: promo?.buyQty ?? 1, getQty: promo?.getQty ?? 1, bundlePrice: promo?.bundlePrice ?? 0,
    effectiveFrom: promo?.effectiveFrom?.slice(0, 10) || '', effectiveTo: promo?.effectiveTo?.slice(0, 10) || '', priority: promo?.priority ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!f.name.trim()) return toast.error('Name required.')
    setSaving(true)
    try {
      const body = JSON.stringify(f)
      if (promo) await request(`/api/promotions/${promo.id}`, { method: 'PATCH', body })
      else await request('/api/promotions', { method: 'POST', body })
      toast.success('Saved'); onSaved()
    } catch (e: unknown) { toast.error(e instanceof Error ? e.message : 'Failed') } finally { setSaving(false) }
  }
  const inp = 'w-full px-3 py-2 border-2 border-gray-200 rounded-xl text-sm focus:border-indigo-500 focus:outline-none'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4"><h3 className="font-bold text-gray-900">{promo ? 'Edit' : 'New'} promotion</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div>
        <div className="space-y-3">
          <div><label className="block text-xs font-semibold text-gray-600 mb-1">Name *</label><input className={inp} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Type</label><select className={inp} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="PERCENTAGE">Percentage off</option><option value="FIXED">Fixed amount off</option><option value="BUY_X_GET_Y">Buy X Get Y</option><option value="BUNDLE">Bundle price</option></select></div>
            {(f.type === 'PERCENTAGE' || f.type === 'FIXED') && <div><label className="block text-xs font-semibold text-gray-600 mb-1">{f.type === 'PERCENTAGE' ? 'Percent (0-100)' : 'Amount off'}</label><input type="number" className={inp} value={f.value} onChange={(e) => setF({ ...f, value: Number(e.target.value) })} /></div>}
            {f.type === 'BUNDLE' && <div><label className="block text-xs font-semibold text-gray-600 mb-1">Bundle price</label><input type="number" className={inp} value={f.bundlePrice} onChange={(e) => setF({ ...f, bundlePrice: Number(e.target.value) })} /></div>}
          </div>
          {f.type === 'BUY_X_GET_Y' && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Buy qty</label><input type="number" className={inp} value={f.buyQty} onChange={(e) => setF({ ...f, buyQty: Number(e.target.value) })} /></div>
              <div><label className="block text-xs font-semibold text-gray-600 mb-1">Get free qty</label><input type="number" className={inp} value={f.getQty} onChange={(e) => setF({ ...f, getQty: Number(e.target.value) })} /></div>
            </div>
          )}
          {(f.type === 'BUY_X_GET_Y' || f.type === 'PERCENTAGE' || f.type === 'FIXED') && (
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Target product {f.type !== 'BUY_X_GET_Y' && '(optional — blank = all)'}</label><select className={inp} value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}><option value="">All products</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          )}
          {f.type === 'BUNDLE' && <p className="text-[11px] text-amber-600">Bundle product configuration (which products + quantities) can be set via API; the discount = (sum of normal prices − bundle price).</p>}
          <div className="grid grid-cols-2 gap-2">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Outlet (optional)</label><select className={inp} value={f.outletId} onChange={(e) => setF({ ...f, outletId: e.target.value })}><option value="">Any</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Customer group (optional)</label><select className={inp} value={f.customerGroupId} onChange={(e) => setF({ ...f, customerGroupId: e.target.value })}><option value="">Any</option>{groups.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">From</label><input type="date" className={inp} value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">To</label><input type="date" className={inp} value={f.effectiveTo} onChange={(e) => setF({ ...f, effectiveTo: e.target.value })} /></div>
            <div><label className="block text-xs font-semibold text-gray-600 mb-1">Priority</label><input type="number" className={inp} value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })} /></div>
          </div>
        </div>
        <div className="flex gap-2 mt-4"><Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button><Button className="flex-1" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button></div>
      </div>
    </div>
  )
}
