'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

interface Cat { id: string; code: string; label: string; isActive: boolean }

export default function PersonCategoriesPage() {
  const { request } = useApi()
  const [items, setItems] = useState<Cat[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cats, access] = await Promise.all([request('/api/person-categories'), request('/api/persons-access')])
      setItems(cats || [])
      setCanManage(!!access?.canManage)
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!newName.trim()) return
    try {
      await request('/api/person-categories', { method: 'POST', body: JSON.stringify({ label: newName.trim() }) })
      toast.success('Category added'); setNewName(''); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not add') }
  }
  const saveEdit = async (id: string) => {
    try { await request(`/api/person-categories/${id}`, { method: 'PUT', body: JSON.stringify({ label: editValue.trim() }) }); toast.success('Saved'); setEditing(null); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not save') }
  }
  const toggle = async (c: Cat) => {
    try { await request(`/api/person-categories/${c.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !c.isActive }) }); load() }
    catch { toast.error('Could not update') }
  }
  const remove = async (c: Cat) => {
    if (!confirm(`Delete category "${c.label}"?`)) return
    try { await request(`/api/person-categories/${c.id}`, { method: 'DELETE' }); toast.success('Deleted'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not delete') }
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Categories</h1>
          <p className="text-gray-500 text-sm">Person &amp; bill categories used across the system</p>
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
                placeholder="New category name (e.g. Sponsors)…"
                className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
              <button onClick={add} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Add Category</button>
            </div>
          )}
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : (
            <div className="divide-y divide-gray-50">
              {items.map((c) => (
                <div key={c.id} className="flex items-center gap-2 py-2.5">
                  {editing === c.id ? (
                    <>
                      <input value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus
                        className="flex-1 px-3 py-2 border-2 border-indigo-300 rounded-lg text-sm focus:border-indigo-500 focus:outline-none" />
                      <button onClick={() => saveEdit(c.id)} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg">Save</button>
                      <button onClick={() => setEditing(null)} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg">Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className={`flex-1 text-sm ${c.isActive ? 'text-gray-800 font-medium' : 'text-gray-400 line-through'}`}>{c.label}</span>
                      <span className="font-mono text-[11px] text-gray-400">{c.code}</span>
                      {canManage && (
                        <div className="flex gap-1.5 ml-2">
                          <button onClick={() => { setEditing(c.id); setEditValue(c.label) }} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100">Edit</button>
                          <button onClick={() => toggle(c)} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">{c.isActive ? 'Disable' : 'Enable'}</button>
                          <button onClick={() => remove(c)} className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100">Delete</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              {items.length === 0 && <p className="py-6 text-center text-gray-400 text-sm">No categories yet</p>}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400">New categories appear as a person type, a Signed-Bill type, and a payment category — so their bills and payments auto-link.</p>
      </div>
    </AppShell>
  )
}
