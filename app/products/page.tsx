'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency } from '@/lib/utils'
import { SearchBox } from '@/components/SearchBox'
import { MoneyInput } from '@/components/MoneyInput'
import toast from 'react-hot-toast'

interface Product {
  id: string; code: string; name: string; buyingPrice: number; sellingPrice: number
  unitMeasure: string; isActive: boolean
}

const UNITS = ['unit', 'kg', 'crate 24 bottle', 'crate 25 bottle', 'crate 6 bottle']
const INIT = { name: '', buyingPrice: '', sellingPrice: '', unitMeasure: 'unit', code: '' }

export default function ProductsPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const [items, setItems] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ ...INIT })

  const canManage = ['ADMIN', 'ACCOUNTANT', 'MANAGER'].includes(user?.role || '')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const its = await request('/api/products')
      setItems(its || [])
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const openNew = () => { setEditingId(null); setForm({ ...INIT }); setShowForm(true) }
  const openEdit = (p: Product) => {
    setEditingId(p.id)
    setForm({ name: p.name, buyingPrice: String(p.buyingPrice), sellingPrice: String(p.sellingPrice), unitMeasure: p.unitMeasure, code: p.code })
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Product name is required')
    setSubmitting(true)
    try {
      const payload = JSON.stringify({
        name: form.name, buyingPrice: Number(form.buyingPrice) || 0, sellingPrice: Number(form.sellingPrice) || 0,
        unitMeasure: form.unitMeasure, ...(editingId ? { code: form.code } : {}),
      })
      if (editingId) await request(`/api/products/${editingId}`, { method: 'PUT', body: payload })
      else await request('/api/products', { method: 'POST', body: payload })
      toast.success(editingId ? 'Product updated' : 'Product created')
      setForm({ ...INIT }); setEditingId(null); setShowForm(false)
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save product')
    } finally { setSubmitting(false) }
  }

  const toggleActive = async (p: Product) => {
    try { await request(`/api/products/${p.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !p.isActive }) }); load() }
    catch { toast.error('Could not update') }
  }

  const remove = async (p: Product) => {
    if (!window.confirm(`Delete "${p.name}" (${p.code})?`)) return
    try { await request(`/api/products/${p.id}`, { method: 'DELETE' }); toast.success('Deleted'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not delete') }
  }

  const q = search.trim().toLowerCase()
  const filtered = items.filter((p) => !q || `${p.name} ${p.code} ${p.unitMeasure}`.toLowerCase().includes(q))

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Products</h1>
            <p className="text-gray-500 text-sm">Catalogue with codes, prices and unit measures</p>
          </div>
          {canManage && (
            <button onClick={openNew}
              className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
              ➕ Create Product
            </button>
          )}
        </div>

        {showForm && canManage && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">{editingId ? 'Edit Product' : 'New Product'}</h2>
            <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-semibold text-gray-700 mb-1">Product Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="e.g. Coca Cola 500ml" required />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Product Code</label>
                <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none uppercase"
                  placeholder={editingId ? '' : 'Auto-generated if left blank'} />
                <p className="text-xs text-gray-400 mt-1">{editingId ? 'Change with care — used on records.' : 'Leave blank and the system creates one (e.g. COC-001).'}</p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Unit Measure</label>
                <select value={form.unitMeasure} onChange={(e) => setForm({ ...form, unitMeasure: e.target.value })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Buying Price (TZS)</label>
                <MoneyInput value={form.buyingPrice} onChange={(v) => setForm({ ...form, buyingPrice: v })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="0" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Selling Price (TZS)</label>
                <MoneyInput value={form.sellingPrice} onChange={(v) => setForm({ ...form, sellingPrice: v })}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" placeholder="0" />
              </div>
              <div className="sm:col-span-2 flex gap-3">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                  {submitting ? 'Saving…' : editingId ? 'Update Product' : 'Create Product'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null); setForm({ ...INIT }) }}
                  className="px-6 py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">Cancel</button>
              </div>
            </form>
          </div>
        )}

        <SearchBox value={search} onChange={setSearch} placeholder="Search by name, code or unit…" />

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {loading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Code</th>
                    <th className="px-4 py-3 font-semibold">Product</th>
                    <th className="px-4 py-3 font-semibold">Unit</th>
                    <th className="px-4 py-3 font-semibold">Buying</th>
                    <th className="px-4 py-3 font-semibold">Selling</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    {canManage && <th className="px-4 py-3 font-semibold text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-indigo-700 font-semibold">{p.code}</td>
                      <td className={`px-4 py-3 font-medium ${p.isActive ? 'text-gray-800' : 'text-gray-400 line-through'}`}>{p.name}</td>
                      <td className="px-4 py-3 text-gray-500">{p.unitMeasure}</td>
                      <td className="px-4 py-3 text-gray-600">{formatCurrency(p.buyingPrice)}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{formatCurrency(p.sellingPrice)}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{p.isActive ? 'Active' : 'Disabled'}</span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button onClick={() => openEdit(p)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 mr-1">Edit</button>
                          <button onClick={() => toggleActive(p)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-50 text-gray-600 hover:bg-gray-100 mr-1">{p.isActive ? 'Disable' : 'Enable'}</button>
                          <button onClick={() => remove(p)} className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-700 hover:bg-red-100">Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={canManage ? 7 : 6} className="text-center py-12 text-gray-400">No products yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
