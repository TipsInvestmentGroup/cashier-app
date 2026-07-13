'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useConfirm } from '@/components/ui/ConfirmProvider'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

interface PosTable { id: string; number: number; label: string | null; capacity: number; isActive: boolean }
interface Outlet { id: string; name: string }

export default function PosTablesPage() {
  const { request } = useApi()
  const { user } = useAuth()
  const confirm = useConfirm()

  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletId, setOutletId] = useState('')
  const [tables, setTables] = useState<PosTable[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ number: '', label: '', capacity: '4', isActive: true })

  const isAdmin = user?.role === 'ADMIN'

  useEffect(() => {
    request('/api/outlets').then((os: Outlet[]) => {
      setOutlets(os)
      setOutletId((cur) => cur || os[0]?.id || '')
    }).catch(() => {})
  }, [request])

  const load = useCallback(async () => {
    if (!outletId) return
    setLoading(true)
    try {
      const data = await request(`/api/pos/tables/manage?outletId=${outletId}`)
      setTables(data)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error loading tables')
    } finally { setLoading(false) }
  }, [request, outletId])

  useEffect(() => { load() }, [load])

  if (!isAdmin) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-5xl mb-3">🔒</div>
          <p className="text-gray-600 font-medium">Admin access required</p>
        </div>
      </div>
    </AppShell>
  )

  const resetForm = () => setForm({ number: '', label: '', capacity: '4', isActive: true })
  const newTable = () => { setEditingId(null); resetForm(); setShowForm((s) => !s) }
  const startEdit = (t: PosTable) => {
    setEditingId(t.id)
    setForm({ number: String(t.number), label: t.label || '', capacity: String(t.capacity), isActive: t.isActive })
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const body = { outletId, number: form.number, label: form.label, capacity: form.capacity, isActive: form.isActive }
    try {
      if (editingId) {
        await request(`/api/pos/tables/manage/${editingId}`, { method: 'PATCH', body: JSON.stringify(body) })
        toast.success('Table updated!')
      } else {
        await request('/api/pos/tables/manage', { method: 'POST', body: JSON.stringify(body) })
        toast.success('Table added!')
      }
      resetForm(); setEditingId(null); setShowForm(false); load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error saving table')
    } finally { setSubmitting(false) }
  }

  const toggleActive = async (t: PosTable) => {
    try {
      await request(`/api/pos/tables/manage/${t.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !t.isActive }) })
      toast.success(t.isActive ? 'Table deactivated' : 'Table reactivated')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error')
    }
  }

  const deleteTable = async (t: PosTable) => {
    if (!(await confirm({ title: 'Delete table', message: `Delete table ${t.number}${t.label ? ` (${t.label})` : ''}? This cannot be undone.`, danger: true, confirmLabel: 'Delete' }))) return
    try {
      await request(`/api/pos/tables/manage/${t.id}`, { method: 'DELETE' })
      toast.success('Table deleted')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Error deleting table')
    }
  }

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tables</h1>
            <p className="text-gray-500 text-sm">Manage the Floor Map's tables per outlet</p>
          </div>
          <div className="flex items-center gap-3">
            <select value={outletId} onChange={(e) => setOutletId(e.target.value)}
              className="px-3 py-2 border-2 border-gray-200 rounded-xl text-sm font-medium focus:border-indigo-500 focus:outline-none">
              {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <Button onClick={newTable} size="lg"><span>+</span> New Table</Button>
          </div>
        </div>

        {showForm && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-800 mb-5">{editingId ? 'Edit Table' : 'Add New Table'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Table Number *</label>
                  <input type="number" min={1} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" required />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Label (optional)</label>
                  <input type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="e.g. VIP 1, Outside 3"
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">Capacity</label>
                  <input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none" />
                </div>
                {editingId && (
                  <div className="flex items-center gap-2 pt-7">
                    <input id="isActive" type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="w-4 h-4" />
                    <label htmlFor="isActive" className="text-sm font-semibold text-gray-700">Active (uncheck to hide from Floor Map)</label>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                <button type="submit" disabled={submitting}
                  className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition disabled:opacity-60">
                  {submitting ? 'Saving...' : editingId ? 'Update Table' : 'Add Table'}
                </button>
                <button type="button" onClick={() => { setShowForm(false); setEditingId(null) }}
                  className="px-6 py-3 border-2 border-gray-200 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">Loading...</div>
        ) : tables.length === 0 ? (
          <EmptyState icon="🍽️" title="No tables at this outlet yet" hint="Add the first table with the button above." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {tables.map((t) => (
              <div key={t.id} className={`rounded-2xl border-2 p-4 text-center transition ${t.isActive ? 'bg-white border-gray-100 hover:border-indigo-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                <div className="font-bold text-2xl text-gray-800">{t.number}</div>
                {t.label && <div className="text-xs text-gray-500 truncate mt-0.5">{t.label}</div>}
                <div className="text-[11px] text-gray-400 mt-1">Seats {t.capacity}</div>
                <span className={`inline-block mt-2 px-2 py-0.5 rounded-lg text-[10px] font-semibold ${t.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {t.isActive ? 'Active' : 'Inactive'}
                </span>
                <div className="flex items-center justify-center gap-1 mt-3">
                  <button onClick={() => startEdit(t)} className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Edit</button>
                  <button onClick={() => toggleActive(t)} className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-700 hover:bg-amber-100">
                    {t.isActive ? 'Hide' : 'Show'}
                  </button>
                  <button onClick={() => deleteTable(t)} className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-red-50 text-red-700 hover:bg-red-100">Del</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
