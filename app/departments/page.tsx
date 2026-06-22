'use client'
import { useEffect, useState, useCallback } from 'react'
import { AppShell } from '@/components/Layout/AppShell'
import { SetupTabs } from '@/components/Layout/SetupTabs'
import { useApi } from '@/hooks/useApi'
import { useAuth } from '@/contexts/AuthContext'
import toast from 'react-hot-toast'

interface NamedItem { id: string; name: string; isActive: boolean }
interface SimpleUser { id: string; name: string; email: string }

export default function DepartmentsPage() {
  const { request } = useApi()
  const { user } = useAuth()

  const [departments, setDepartments] = useState<NamedItem[]>([])
  const [functions, setFunctions] = useState<NamedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [canManage, setCanManage] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [fixedManagers, setFixedManagers] = useState<string[]>([])
  const [managerEmail, setManagerEmail] = useState('')

  // new-item inputs
  const [newDept, setNewDept] = useState('')
  const [newFn, setNewFn] = useState('')
  // edit state: { kind, id } + value
  const [editing, setEditing] = useState<{ kind: 'dept' | 'fn'; id: string } | null>(null)
  const [editValue, setEditValue] = useState('')

  // Manage-access modal (owner only)
  const [accessOpen, setAccessOpen] = useState(false)
  const [allUsers, setAllUsers] = useState<SimpleUser[]>([])
  const [pickEmail, setPickEmail] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [depts, fns, access] = await Promise.all([
        request('/api/departments'), request('/api/functions'), request('/api/petty-access'),
      ])
      setDepartments(depts || [])
      setFunctions(fns || [])
      setCanManage(!!access?.canManageDepartments)
      setIsOwner(!!access?.isOwner)
      setFixedManagers(access?.deptFixedManagers || [])
      setManagerEmail(access?.deptManagerEmail || '')
    } finally { setLoading(false) }
  }, [request])

  useEffect(() => { load() }, [load])

  const openAccess = async () => {
    try {
      const us = await request('/api/users')
      setAllUsers(us || [])
      setPickEmail(managerEmail)
      setAccessOpen(true)
    } catch { toast.error('Could not load users') }
  }

  const saveAccess = async () => {
    try {
      await request('/api/petty-access', { method: 'PUT', body: JSON.stringify({ email: pickEmail }) })
      setManagerEmail(pickEmail)
      toast.success('Access updated')
      setAccessOpen(false)
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update access')
    }
  }

  const addItem = async (kind: 'dept' | 'fn') => {
    const name = (kind === 'dept' ? newDept : newFn).trim()
    if (!name) return
    const url = kind === 'dept' ? '/api/departments' : '/api/functions'
    try {
      await request(url, { method: 'POST', body: JSON.stringify({ name }) })
      toast.success(kind === 'dept' ? 'Department added' : 'Function added')
      if (kind === 'dept') setNewDept(''); else setNewFn('')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not add')
    }
  }

  const saveEdit = async () => {
    if (!editing) return
    const url = editing.kind === 'dept' ? `/api/departments/${editing.id}` : `/api/functions/${editing.id}`
    try {
      await request(url, { method: 'PUT', body: JSON.stringify({ name: editValue.trim() }) })
      toast.success('Saved')
      setEditing(null); setEditValue('')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const toggleActive = async (kind: 'dept' | 'fn', it: NamedItem) => {
    const url = kind === 'dept' ? `/api/departments/${it.id}` : `/api/functions/${it.id}`
    try {
      await request(url, { method: 'PUT', body: JSON.stringify({ isActive: !it.isActive }) })
      load()
    } catch { toast.error('Could not update') }
  }

  const removeItem = async (kind: 'dept' | 'fn', it: NamedItem) => {
    if (!confirm(`Delete "${it.name}"?`)) return
    const url = kind === 'dept' ? `/api/departments/${it.id}` : `/api/functions/${it.id}`
    try {
      await request(url, { method: 'DELETE' })
      toast.success('Deleted')
      load()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  const renderList = (kind: 'dept' | 'fn', items: NamedItem[]) => (
    <div className="divide-y divide-gray-50">
      {items.map((it) => (
        <div key={it.id} className="flex items-center gap-2 py-2.5">
          {editing && editing.kind === kind && editing.id === it.id ? (
            <>
              <input value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus
                className="flex-1 px-3 py-2 border-2 border-indigo-300 rounded-lg focus:border-indigo-500 focus:outline-none text-sm" />
              <button onClick={saveEdit} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700">Save</button>
              <button onClick={() => { setEditing(null); setEditValue('') }} className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200">Cancel</button>
            </>
          ) : (
            <>
              <span className={`flex-1 text-sm ${it.isActive ? 'text-gray-800 font-medium' : 'text-gray-400 line-through'}`}>{it.name}</span>
              {canManage && (
                <div className="flex gap-1.5">
                  <button onClick={() => { setEditing({ kind, id: it.id }); setEditValue(it.name) }}
                    className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-lg hover:bg-indigo-100">Edit</button>
                  <button onClick={() => toggleActive(kind, it)}
                    className="px-2.5 py-1 bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-100">{it.isActive ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => removeItem(kind, it)}
                    className="px-2.5 py-1 bg-red-50 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-100">Delete</button>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {items.length === 0 && <p className="py-6 text-center text-gray-400 text-sm">None yet</p>}
    </div>
  )

  return (
    <AppShell>
      <SetupTabs />
      <div className="space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Departments &amp; Functions</h1>
            <p className="text-gray-500 text-sm">Manage the options used on the cash-request form</p>
          </div>
          {isOwner && (
            <button onClick={openAccess}
              className="px-5 py-3 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition shadow">
              🔐 Manage Access
            </button>
          )}
        </div>

        {!canManage && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            👁️ View only. Editing is limited to the owner, the fixed managers, and the owner-chosen manager.
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-gray-400">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Departments */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-800 mb-3">🗂️ Departments</h2>
              {canManage && (
                <div className="flex gap-2 mb-3">
                  <input value={newDept} onChange={(e) => setNewDept(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addItem('dept') }}
                    placeholder="New department name…"
                    className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
                  <button onClick={() => addItem('dept')} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Add</button>
                </div>
              )}
              {renderList('dept', departments)}
            </div>

            {/* Functions */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
              <h2 className="font-semibold text-gray-800 mb-3">🧩 Functions</h2>
              {canManage && (
                <div className="flex gap-2 mb-3">
                  <input value={newFn} onChange={(e) => setNewFn(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addItem('fn') }}
                    placeholder="New function name…"
                    className="flex-1 px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none text-sm" />
                  <button onClick={() => addItem('fn')} className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700">Add</button>
                </div>
              )}
              {renderList('fn', functions)}
            </div>
          </div>
        )}
      </div>

      {/* Manage Access modal (owner only) */}
      {accessOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAccessOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white w-full max-w-md rounded-2xl shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-gray-900">🔐 Departments Access</h3>
              <button onClick={() => setAccessOpen(false)} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">✕</button>
            </div>
            <div className="text-sm text-gray-600 space-y-1">
              <p className="font-semibold text-gray-700">Always allowed:</p>
              <ul className="list-disc list-inside text-gray-500">
                <li>Owner ({user?.email})</li>
                {fixedManagers.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">4th manager (you choose)</label>
              <select value={pickEmail} onChange={(e) => setPickEmail(e.target.value)}
                className="w-full px-3 py-2.5 border-2 border-gray-200 rounded-xl focus:border-indigo-500 focus:outline-none bg-white">
                <option value="">— None —</option>
                {allUsers.map((u) => <option key={u.id} value={u.email}>{u.name} ({u.email})</option>)}
              </select>
            </div>
            <button onClick={saveAccess}
              className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition">
              Save Access
            </button>
          </div>
        </div>
      )}
    </AppShell>
  )
}
