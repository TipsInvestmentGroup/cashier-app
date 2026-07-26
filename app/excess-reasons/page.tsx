'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import toast from 'react-hot-toast'

interface Reason { id: string; code: string; label: string; category: string; isActive: boolean; allocationStrategy: string }

const PROTECTED_CODES = ['STAFF_TIP', 'CUSTOMER_EXCESS', 'STAFF_LOSS']
const CATEGORY_OPTS: { value: string; label: string }[] = [
  { value: 'PAYABLE_EXCESS', label: 'Payable Excess' },
  { value: 'NON_PAYABLE', label: 'Non-Payable (audit only)' },
  { value: 'STAFF_LOSS', label: 'Staff Loss' },
]
const CATEGORY_BADGE: Record<string, string> = {
  PAYABLE_EXCESS: 'bg-amber-100 text-amber-700',
  NON_PAYABLE: 'bg-gray-100 text-gray-600',
  STAFF_LOSS: 'bg-red-100 text-red-700',
}
const categoryLabel = (v: string) => CATEGORY_OPTS.find((c) => c.value === v)?.label || v

export default function ExcessReasonsPage() {
  const { request } = useApi()
  const [items, setItems] = useState<Reason[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('NON_PAYABLE')
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reasons, access] = await Promise.all([request('/api/excess-reasons'), request('/api/persons-access')])
      setItems(reasons || [])
      setCanManage(!!access?.canManage)
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!newName.trim()) return
    try {
      await request('/api/excess-reasons', { method: 'POST', body: JSON.stringify({ label: newName.trim(), category: newCategory }) })
      toast.success('Reason added'); setNewName(''); setNewCategory('NON_PAYABLE'); load()
    } catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not add') }
  }
  const saveEdit = async (id: string) => {
    try { await request(`/api/excess-reasons/${id}`, { method: 'PUT', body: JSON.stringify({ label: editValue.trim() }) }); toast.success('Saved'); setEditing(null); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not save') }
  }
  const changeCategory = async (r: Reason, category: string) => {
    try { await request(`/api/excess-reasons/${r.id}`, { method: 'PUT', body: JSON.stringify({ category }) }); toast.success('Category updated'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not update category') }
  }
  const changeAllocationStrategy = async (r: Reason, allocationStrategy: string) => {
    try { await request(`/api/excess-reasons/${r.id}`, { method: 'PUT', body: JSON.stringify({ allocationStrategy }) }); toast.success('Settlement order updated'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not update settlement order') }
  }
  const toggle = async (r: Reason) => {
    try { await request(`/api/excess-reasons/${r.id}`, { method: 'PUT', body: JSON.stringify({ isActive: !r.isActive }) }); load() }
    catch { toast.error('Could not update') }
  }
  const remove = async (r: Reason) => {
    if (!confirm(`Delete reason "${r.label}"?`)) return
    try { await request(`/api/excess-reasons/${r.id}`, { method: 'DELETE' }); toast.success('Deleted'); load() }
    catch (err: unknown) { toast.error(err instanceof Error ? err.message : 'Could not delete') }
  }

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Difference Reasons</h1>
          <p className="text-gray-500 text-sm">Reasons offered on the Collection form&apos;s Difference Reason picker and Excess Recon. Category decides the workflow: Payable Excess creates a record settled via Excess Payment; Non-Payable is audit-only; Staff Loss drives the payroll-deduction debt path.</p>
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
                placeholder="New reason (e.g. Till Float)…"
                className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
              <select value={newCategory} onChange={(e) => setNewCategory(e.target.value)}
                className="px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm bg-white">
                {CATEGORY_OPTS.filter((c) => c.value !== 'STAFF_LOSS').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <button onClick={add} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Add Reason</button>
            </div>
          )}
          {loading ? <div className="py-10 text-center text-gray-400">Loading…</div> : (
            <div className="divide-y divide-gray-50">
              {items.map((r) => (
                <div key={r.id} className="flex items-center gap-2 py-2.5">
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
                      <span className="font-mono text-[11px] text-gray-400">{r.code}</span>
                      {canManage && !PROTECTED_CODES.includes(r.code) ? (
                        <select value={r.category} onChange={(e) => changeCategory(r, e.target.value)}
                          className={`px-2 py-1 rounded-lg text-xs font-bold border-0 ${CATEGORY_BADGE[r.category] || 'bg-gray-100 text-gray-600'}`}>
                          {CATEGORY_OPTS.filter((c) => c.value !== 'STAFF_LOSS').map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      ) : (
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${CATEGORY_BADGE[r.category] || 'bg-gray-100 text-gray-600'}`}>{categoryLabel(r.category)}</span>
                      )}
                      {r.category === 'PAYABLE_EXCESS' && (
                        canManage ? (
                          <select value={r.allocationStrategy} onChange={(e) => changeAllocationStrategy(r, e.target.value)}
                            title="Order the auto-settlement engine applies a Cash Recon payment against this reason's outstanding balances"
                            className="px-2 py-1 rounded-lg text-xs font-bold border-0 bg-blue-50 text-blue-700">
                            <option value="FIFO">Oldest first (FIFO)</option>
                            <option value="LIFO">Newest first (LIFO)</option>
                          </select>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700">{r.allocationStrategy === 'LIFO' ? 'Newest first' : 'Oldest first'}</span>
                        )
                      )}
                      {canManage && (
                        <div className="flex gap-1.5 ml-2">
                          <button onClick={() => { setEditing(r.id); setEditValue(r.label) }} className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100">Edit</button>
                          <button onClick={() => toggle(r)} className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">{r.isActive ? 'Disable' : 'Enable'}</button>
                          {!PROTECTED_CODES.includes(r.code) && (
                            <button onClick={() => remove(r)} className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100">Delete</button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
              {items.length === 0 && <p className="py-6 text-center text-gray-400 text-sm">No reasons yet</p>}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400">Staff Tip and Customer Excess unlock a staff/customer picker, and Staff Loss drives the payroll-deduction debt path — all three are wired into fixed engine behavior, so their category can&apos;t be changed and they can&apos;t be deleted (disable them instead if unused).</p>
      </div>
    </AppShell>
  )
}
