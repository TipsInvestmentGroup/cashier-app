'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'

interface Reason { id: string; code: string; label: string; isActive: boolean; appliesToAll: boolean; categoryIds: string[]; productIds: string[] }
interface Category { id: string; label: string; isActive: boolean }
interface ProductLite { id: string; name: string; isActive: boolean }

export default function CancellationReasonsPage() {
  const { request } = useApi()
  const [items, setItems] = useState<Reason[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<ProductLite[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [mapping, setMapping] = useState<{ appliesToAll: boolean; categoryIds: string[]; productIds: string[] } | null>(null)
  const [savingMapping, setSavingMapping] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reasons, access, cats, prods] = await Promise.all([
        request('/api/cancellation-reasons'), request('/api/persons-access'),
        request('/api/product-categories').catch(() => []), request('/api/products').catch(() => []),
      ])
      setItems(reasons || [])
      setCanManage(!!access?.canManage)
      setCategories((cats || []).filter((c: Category) => c.isActive))
      setProducts((prods || []).filter((p: ProductLite) => p.isActive))
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!newName.trim()) return
    try {
      await request('/api/cancellation-reasons', { method: 'POST', body: JSON.stringify({ label: newName.trim() }) })
      toast.success('Reason added'); setNewName(''); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not add') }
  }
  const saveEdit = async (id: string) => {
    try { await request(`/api/cancellation-reasons/${id}`, { method: 'PUT', body: JSON.stringify({ label: editValue.trim() }) }); toast.success('Saved'); setEditing(null); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not save') }
  }
  const toggle = async (r: Reason) => {
    try { await request(`/api/cancellation-reasons/${r.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !r.isActive }) }); load() }
    catch { toast.error('Could not update') }
  }
  const remove = async (r: Reason) => {
    if (!confirm(`Delete reason "${r.label}"?`)) return
    try { await request(`/api/cancellation-reasons/${r.id}`, { method: 'DELETE' }); toast.success('Deleted'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not delete') }
  }

  const toggleExpand = (r: Reason) => {
    if (expanded === r.id) { setExpanded(null); setMapping(null); return }
    setExpanded(r.id)
    setMapping({ appliesToAll: r.appliesToAll, categoryIds: [...r.categoryIds], productIds: [...r.productIds] })
  }
  const saveMapping = async (id: string) => {
    if (!mapping) return
    setSavingMapping(true)
    try {
      await request(`/api/cancellation-reasons/${id}`, { method: 'PUT', body: JSON.stringify(mapping) })
      toast.success('Mapping saved'); setExpanded(null); setMapping(null); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not save mapping') }
    finally { setSavingMapping(false) }
  }
  const toggleId = (list: string[], id: string) => list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cancellation Reasons</h1>
          <p className="text-gray-500 text-sm">Reasons available when recording a cancelled punch on Daily Collections — each can apply to every product, or be scoped to specific categories/products.</p>
        </div>

        {!canManage && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            👁️ View only. Adding/editing is limited to the owner, the fixed manager, and the owner-chosen persons manager.
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          {canManage && (
            <div className="flex gap-2 mb-4">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }}
                placeholder="New reason (e.g. Customer Complaint)…"
                className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
              <button onClick={add} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Add Reason</button>
            </div>
          )}
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : (
            <div className="divide-y divide-gray-50">
              {items.map((r) => (
                <div key={r.id} className="py-2.5">
                  <div className="flex items-center gap-2">
                    {editing === r.id ? (
                      <>
                        <input value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus
                          className="flex-1 px-3 py-2 border-2 border-indigo-300 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
                        <button onClick={() => saveEdit(r.id)} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg">Save</button>
                        <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg">Cancel</button>
                      </>
                    ) : (
                      <>
                        <span className={`flex-1 text-sm ${r.isActive ? 'text-gray-800 font-medium' : 'text-gray-400 line-through'}`}>{r.label}</span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-gray-50 text-gray-400">
                          {r.appliesToAll ? 'All products' : `${r.categoryIds.length} categor${r.categoryIds.length === 1 ? 'y' : 'ies'}, ${r.productIds.length} product(s)`}
                        </span>
                        <span className="font-mono text-[11px] text-gray-400">{r.code}</span>
                        {canManage && (
                          <div className="flex gap-1.5 ml-2">
                            <button onClick={() => toggleExpand(r)} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100 flex items-center gap-1">
                              Mapping {expanded === r.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                            <button onClick={() => { setEditing(r.id); setEditValue(r.label) }} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100">Edit</button>
                            <button onClick={() => toggle(r)} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">{r.isActive ? 'Disable' : 'Enable'}</button>
                            <button onClick={() => remove(r)} className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100">Delete</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {expanded === r.id && mapping && (
                    <div className="mt-3 ml-2 p-3 bg-gray-50 rounded-xl space-y-3">
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input type="checkbox" checked={mapping.appliesToAll} onChange={(e) => setMapping({ ...mapping, appliesToAll: e.target.checked })} />
                        Applies to all products
                      </label>
                      {!mapping.appliesToAll && (
                        <>
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1.5">Product Categories</p>
                            <div className="flex flex-wrap gap-1.5">
                              {categories.length === 0 && <p className="text-xs text-gray-400">No categories yet — add some under Product Categories.</p>}
                              {categories.map((c) => (
                                <button key={c.id} type="button" onClick={() => setMapping({ ...mapping, categoryIds: toggleId(mapping.categoryIds, c.id) })}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${mapping.categoryIds.includes(c.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                                  {c.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-500 mb-1.5">Specific Products</p>
                            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                              {products.map((p) => (
                                <button key={p.id} type="button" onClick={() => setMapping({ ...mapping, productIds: toggleId(mapping.productIds, p.id) })}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${mapping.productIds.includes(p.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                                  {p.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button onClick={() => saveMapping(r.id)} disabled={savingMapping} className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                          {savingMapping ? 'Saving…' : 'Save Mapping'}
                        </button>
                        <button onClick={() => { setExpanded(null); setMapping(null) }} className="px-4 py-2 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {items.length === 0 && <p className="py-6 text-center text-gray-400 text-sm">No reasons yet</p>}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400">Used by the Cancellations picker on Daily Collections.</p>
      </div>
    </AppShell>
  )
}
